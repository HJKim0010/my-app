import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { authClient } from "../auth/historyAuth.ts";
import { loadParticipantArchive } from "./historyArchive.ts";
import { parseShareExpiry } from "./shareExpiry.ts";

const table = "history_share_links";
const summaryFields = "id,created_at,expires_at";
export const shareHeaders = {
  "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive", "X-Content-Type-Options": "nosniff",
};
export type ShareScope = { participantId: string; taskId: "task1" | "task2"; sessionId: string };

export function parseShareScope(value: unknown): ShareScope | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const participantId = typeof input.participantId === "string" ? input.participantId.trim().toUpperCase() : "";
  if (!/^P\d{2,}$/.test(participantId) || (input.taskId !== "task1" && input.taskId !== "task2") ||
      typeof input.sessionId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.sessionId)) return null;
  return { participantId, taskId: input.taskId, sessionId: input.sessionId };
}

export const hashShareToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const validShareToken = (token: unknown): token is string => typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);

function dbError(): never { throw new Error("공유 링크 저장소에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요."); }

export async function listShares(scope: ShareScope) {
  const now = Date.now();
  const { data, error } = await authClient().from(table).select(summaryFields)
    .eq("participant_id", scope.participantId).eq("task_id", scope.taskId).eq("session_id", scope.sessionId)
    .is("revoked_at", null).gt("expires_at", new Date(now).toISOString()).order("created_at", { ascending: false }).limit(100);
  if (error) dbError();
  return data;
}

export async function createShare(scope: ShareScope, adminEmail: string, expiry: unknown = {}) {
  if (parseShareExpiry(expiry) === null) throw new Error("현재보다 이후의 만료 날짜와 시간을 선택해 주세요.");
  if ((await listShares(scope)).length >= 10) throw new Error("이 대화의 활성 링크가 10개입니다. 기존 링크를 중지한 뒤 만들어 주세요.");
  const archive = await loadParticipantArchive(scope.participantId);
  if (archive.warnings.length) throw new Error("전체 대화를 불러오지 못해 공유하지 않았습니다. 잠시 후 다시 시도해 주세요.");
  const session = archive.sessions.find((item) => item.sessionId === scope.sessionId && item.taskId === scope.taskId);
  if (!session) throw new Error("선택한 대화를 찾을 수 없습니다.");
  const snapshot = { participantId: scope.participantId, taskId: session.taskId, timestamp: session.timestamp, messages: session.messages };
  if (Buffer.byteLength(JSON.stringify(snapshot)) > 2_000_000) throw new Error("공유할 대화가 너무 큽니다.");
  const token = randomBytes(32).toString("base64url");
  const createdAt = new Date();
  const expiresAt = parseShareExpiry(expiry, createdAt.getTime());
  if (expiresAt === null) throw new Error("선택한 만료 시간이 지났습니다. 다시 선택해 주세요.");
  const { data, error } = await authClient().from(table).insert({
    participant_id: scope.participantId, task_id: scope.taskId, session_id: scope.sessionId,
    token_hash: hashShareToken(token), snapshot, created_by: adminEmail,
    created_at: createdAt.toISOString(), expires_at: new Date(expiresAt).toISOString(),
  }).select(summaryFields).single();
  if (error) dbError();
  // The raw token is returned once, never stored in the database or logs.
  return { ...data, token };
}

export async function revokeShare(id: string) {
  const { error } = await authClient().from(table).update({ revoked_at: new Date().toISOString(), snapshot: {} }).eq("id", id);
  if (error) dbError();
}

export async function readShare(token: unknown, checkOnly = false) {
  if (!validShareToken(token)) return null;
  const now = Date.now();
  const fields = checkOnly ? "expires_at" : "expires_at,snapshot";
  const { data, error } = await authClient().from(table).select(fields)
    .eq("token_hash", hashShareToken(token)).is("revoked_at", null)
    .gt("expires_at", new Date(now).toISOString()).maybeSingle();
  if (error) dbError();
  if (!data) return null;
  // The selected columns are fixed above; never return token hashes or owner data.
  const row = data as unknown as { expires_at: string; snapshot?: unknown };
  return { expiresAt: row.expires_at, ...(checkOnly ? {} : { conversation: row.snapshot }) };
}
