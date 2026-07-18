import fs from "node:fs";
import path from "node:path";
import type { RecentMessage } from "@/backend/rag/conversationMemory";

type ChatEventTailRow = {
  session_id?: string;
  ep_id?: string;
  task_id?: string;
  raw_user_query?: string;
  assistant_response?: string;
  interaction_count?: number;
  timestamp?: string;
};

export type HistorySource = "frontend" | "frontend_plus_server_fallback";

const LOG_FILE = path.join(process.cwd(), "backend", "logs", "chat-log.jsonl");
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CHAT_EVENTS_TABLE = process.env.SUPABASE_CHAT_EVENTS_TABLE || "chat_events";

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function hasSupabaseConfig(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function toLegacyTaskId(epId: string): string {
  return epId === "ep1" ? "task1" : epId === "ep2" ? "task2" : epId;
}

function rowsToMessages(rows: ChatEventTailRow[]): RecentMessage[] {
  return rows.flatMap((row) => {
    const messages: RecentMessage[] = [];
    const userText = typeof row.raw_user_query === "string" ? compactText(row.raw_user_query) : "";
    const assistantText =
      typeof row.assistant_response === "string" ? compactText(row.assistant_response) : "";

    if (userText) {
      messages.push({ role: "user", text: userText });
    }

    if (assistantText) {
      messages.push({ role: "assistant", text: assistantText });
    }

    return messages;
  });
}

function dedupeMessages(messages: RecentMessage[]): RecentMessage[] {
  const seen = new Set<string>();
  const deduped: RecentMessage[] = [];

  for (const message of messages) {
    const key = `${message.role}:${compactText(message.text)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(message);
  }

  return deduped;
}

function shouldUseServerFallback(recentMessages: RecentMessage[]): boolean {
  if (recentMessages.length === 0) {
    return true;
  }

  const latestAssistantIndex = recentMessages.map((message) => message.role).lastIndexOf("assistant");
  const latestUserIndex = recentMessages.map((message) => message.role).lastIndexOf("user");

  return latestUserIndex > latestAssistantIndex;
}

async function fetchSupabaseTail(sessionId: string, epId: "ep1" | "ep2", limit: number): Promise<ChatEventTailRow[]> {
  if (!hasSupabaseConfig()) {
    return [];
  }

  const base = `${SUPABASE_URL}/rest/v1/${CHAT_EVENTS_TABLE}`;
  const query = new URLSearchParams({
    select: "session_id,ep_id,task_id,raw_user_query,assistant_response,interaction_count,timestamp",
    session_id: `eq.${sessionId}`,
    order: "interaction_count.desc,timestamp.desc",
    limit: String(limit),
  });
  query.append("or", `(ep_id.eq.${epId},task_id.eq.${toLegacyTaskId(epId)})`);

  const response = await fetch(`${base}?${query.toString()}`, {
    method: "GET",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY as string,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY as string}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return [];
  }

  const rows = await response.json();
  return Array.isArray(rows) ? rows.reverse() as ChatEventTailRow[] : [];
}

function readLocalTail(sessionId: string, epId: "ep1" | "ep2", limit: number): ChatEventTailRow[] {
  if (!fs.existsSync(LOG_FILE)) {
    return [];
  }

  const rows = fs
    .readFileSync(LOG_FILE, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as ChatEventTailRow;
      } catch {
        return null;
      }
    })
    .filter((row): row is ChatEventTailRow =>
      Boolean(
        row &&
          row.session_id === sessionId &&
          (row.ep_id === epId || row.task_id === toLegacyTaskId(epId))
      )
    )
    .sort((a, b) => {
      const ai = typeof a.interaction_count === "number" ? a.interaction_count : 0;
      const bi = typeof b.interaction_count === "number" ? b.interaction_count : 0;
      return ai - bi;
    });

  return rows.slice(-limit);
}

export async function buildHistoryWithFallback(params: {
  recentMessages: RecentMessage[];
  sessionId: string;
  epId: "ep1" | "ep2";
  limit?: number;
}): Promise<{ messages: RecentMessage[]; historySource: HistorySource; fallbackCount: number }> {
  const limit = params.limit || 8;

  if (!shouldUseServerFallback(params.recentMessages) || params.sessionId === "unknown-session") {
    return {
      messages: params.recentMessages,
      historySource: "frontend",
      fallbackCount: 0,
    };
  }

  try {
    const supabaseRows = await fetchSupabaseTail(params.sessionId, params.epId, limit);
    const serverRows = supabaseRows.length
      ? supabaseRows
      : readLocalTail(params.sessionId, params.epId, limit);
    const fallbackMessages = rowsToMessages(serverRows);

    if (fallbackMessages.length === 0) {
      return {
        messages: params.recentMessages,
        historySource: "frontend",
        fallbackCount: 0,
      };
    }

    return {
      messages: dedupeMessages([...fallbackMessages, ...params.recentMessages]).slice(-40),
      historySource: "frontend_plus_server_fallback",
      fallbackCount: fallbackMessages.length,
    };
  } catch {
    return {
      messages: params.recentMessages,
      historySource: "frontend",
      fallbackCount: 0,
    };
  }
}
