export type ArchiveMessage = { role: "user" | "assistant"; text: string };
export type ArchiveSession = {
  sessionId: string;
  taskId: "task1" | "task2";
  timestamp: string;
  condition: string;
  messages: ArchiveMessage[];
};

type Row = Record<string, unknown>;
const string = (value: unknown) => typeof value === "string" ? value : "";
const count = (row: Row) => typeof row.interaction_count === "number" ? row.interaction_count : 0;
const time = (row: Row) => Date.parse(string(row.timestamp)) || 0;

function messages(value: unknown): ArchiveMessage[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ArchiveMessage =>
    item !== null && typeof item === "object" &&
    (item.role === "user" || item.role === "assistant") && typeof item.text === "string"
  ).map(({ role, text }) => ({ role, text }));
}

// Snapshots contain the entire conversation: never concatenate every snapshot.
// Keep repeated text on different turns, and retain the original whitespace.
export function buildArchiveSessions(transcripts: Row[], events: Row[], participantId: string): ArchiveSession[] {
  const groups = new Map<string, { taskId: "task1" | "task2"; snapshots: Row[]; turns: Row[] }>();
  for (const [rows, kind] of [[transcripts, "snapshots"], [events, "turns"]] as const) {
    for (const row of rows) {
      if (string(row.participant_id).toUpperCase() !== participantId) continue;
      const episode = row.ep_id || row.task_id || row.episode_id;
      const taskId = episode === "ep1" || episode === "task1" ? "task1"
        : episode === "ep2" || episode === "task2" ? "task2" : null;
      const sessionId = string(row.session_id);
      if (!taskId || !sessionId) continue;
      const key = JSON.stringify([sessionId, taskId]);
      const group = groups.get(key) || { taskId, snapshots: [], turns: [] };
      group[kind].push(row);
      groups.set(key, group);
    }
  }
  return Array.from(groups.values()).map(({ taskId, snapshots, turns }) => {
    const snapshot = snapshots.filter((row) => messages(row.transcript).length > 0)
      .sort((a, b) => count(b) - count(a) || time(b) - time(a))[0];
    const output = snapshot ? messages(snapshot.transcript) : [];
    const ordered = [...turns].sort((a, b) => count(a) - count(b) || time(a) - time(b));
    const byTurn = new Map<string, Row>();
    ordered.forEach((row, index) => {
      // A retried write for the same numbered turn replaces that turn only.
      byTurn.set(count(row) > 0 ? `turn:${count(row)}` : `row:${index}`, row);
    });
    for (const row of byTurn.values()) {
      if (snapshot && (count(snapshot) <= 0 || count(row) <= count(snapshot))) continue;
      const user = string(row.raw_user_query);
      const assistant = string(row.assistant_response);
      if (user) output.push({ role: "user", text: user });
      if (assistant) output.push({ role: "assistant", text: assistant });
    }
    const latest = [...snapshots, ...turns].sort((a, b) => time(b) - time(a))[0];
    return {
      sessionId: string(latest.session_id), taskId,
      timestamp: string(latest.timestamp),
      condition: string(latest.condition_label), messages: output,
    };
  }).filter((session) => session.messages.length > 0)
    .sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0));
}

export async function readArchiveTable(
  baseUrl: string, key: string, table: string, participantId: string,
): Promise<Row[]> {
  const rows: Row[] = [];
  // A small page also works with Supabase projects with a reduced row limit.
  const pageSize = 100;
  for (let offset = 0; offset < 10000;) {
    const query = new URLSearchParams({
      select: "*", participant_id: `eq.${participantId}`,
      order: "timestamp.asc,id.asc", offset: String(offset), limit: String(pageSize),
    });
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/rest/v1/${encodeURIComponent(table)}?${query}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Supabase ${table} 조회 실패 (HTTP ${response.status}). 연결 설정과 테이블을 확인해 주세요.`);
    const page: unknown = await response.json();
    if (!Array.isArray(page)) throw new Error("Supabase 응답 형식을 확인할 수 없습니다.");
    if (!page.length) return rows;
    rows.push(...page);
    offset += page.length;
  }
  throw new Error("참가자 기록이 조회 한도(10,000행)를 초과했습니다. 전체 기록을 표시하려면 조회 범위를 나눠야 합니다.");
}

export async function loadParticipantArchive(participantId: string) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("Supabase 연결 설정이 필요합니다.");
  const results = await Promise.allSettled([
    readArchiveTable(base, key, process.env.SUPABASE_SESSION_TRANSCRIPTS_TABLE || "session_transcripts", participantId),
    readArchiveTable(base, key, process.env.SUPABASE_CHAT_EVENTS_TABLE || "chat_events", participantId),
  ]);
  const warnings = results.flatMap((result) => result.status === "rejected"
    ? ["일부 기록을 불러오지 못했습니다. 연결 상태와 조회 한도를 확인해 주세요."] : []);
  if (results.every((result) => result.status === "rejected")) throw new Error(warnings[0]);
  const [transcripts, events] = results.map((result) => result.status === "fulfilled" ? result.value : []);
  return { sessions: buildArchiveSessions(transcripts, events, participantId), warnings };
}
