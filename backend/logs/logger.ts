import fs from "node:fs";
import path from "node:path";

export type ChatLogEntry = {
  participant_id: string;
  session_id: string;
  task_id: string;
  condition_label: string;
  selected_category: string;
  raw_user_query: string;
  policy_decision: string;
  status: "allowed" | "restricted" | "redirected";
  retrieved_chunk_ids: string[];
  retrieved_chunk_metadata: Array<{
    chunkId: string;
    sourceId: string;
    sourceType: string;
    chunkIndex: number;
    score?: number;
  }>;
  assistant_response: string;
  timestamp: string;
  response_length: number;
  interaction_count: number;
  session_duration_ms: number;
  query_type_label?: string;
  redirect_reason?: string;
  source_types_used?: string[];
  visual_assets_used?: string[];
};

export type SessionTranscriptEntry = {
  participant_id: string;
  session_id: string;
  task_id: string;
  condition_label: string;
  timestamp: string;
  interaction_count: number;
  session_duration_ms: number;
  transcript: Array<{
    role: "user" | "assistant";
    text: string;
  }>;
};

const LOG_DIR = path.join(process.cwd(), "backend", "logs");
const LOG_FILE = path.join(LOG_DIR, "chat-log.jsonl");
const SESSION_TRANSCRIPT_FILE = path.join(LOG_DIR, "session-transcripts.jsonl");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CHAT_EVENTS_TABLE = process.env.SUPABASE_CHAT_EVENTS_TABLE || "chat_events";
const SESSION_TRANSCRIPTS_TABLE =
  process.env.SUPABASE_SESSION_TRANSCRIPTS_TABLE || "session_transcripts";

function hasSupabaseConfig(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

async function insertIntoSupabase(table: string, payload: object): Promise<void> {
  if (!hasSupabaseConfig()) {
    return;
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY as string,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY as string}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase insert failed for ${table}: ${errorText}`);
  }
}

function appendLocalLog(filePath: string, entry: object): void {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, "utf8");
}

function appendLocalFallback(filePath: string, entry: object, error: unknown): void {
  try {
    appendLocalLog(filePath, {
      ...entry,
      supabase_error: error instanceof Error ? error.message : String(error),
    });
  } catch (fallbackError) {
    console.error("Failed to write local fallback log", fallbackError);
  }
}

export async function appendChatLog(entry: ChatLogEntry): Promise<void> {
  if (hasSupabaseConfig()) {
    try {
      await insertIntoSupabase(CHAT_EVENTS_TABLE, {
        ...entry,
        retrieved_chunk_ids: entry.retrieved_chunk_ids,
        retrieved_chunk_metadata: entry.retrieved_chunk_metadata,
        source_types_used: entry.source_types_used || [],
        visual_assets_used: entry.visual_assets_used || [],
      });
      return;
    } catch (error) {
      appendLocalFallback(LOG_FILE, entry, error);
      return;
    }
  }

  appendLocalLog(LOG_FILE, entry);
}

export async function appendSessionTranscript(
  entry: SessionTranscriptEntry
): Promise<void> {
  if (hasSupabaseConfig()) {
    try {
      await insertIntoSupabase(SESSION_TRANSCRIPTS_TABLE, entry);
      return;
    } catch (error) {
      appendLocalFallback(SESSION_TRANSCRIPT_FILE, entry, error);
      return;
    }
  }

  appendLocalLog(SESSION_TRANSCRIPT_FILE, entry);
}
