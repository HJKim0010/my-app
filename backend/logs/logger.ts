import fs from "node:fs";
import path from "node:path";

export type ChatLogEntry = {
  participant_id: string;
  session_id: string;
  ep_id: string;
  condition_label: string;
  selected_category: string;
  raw_user_query: string;
  policy_decision: string;
  policy_reason?: string | null;
  status: "allowed" | "restricted" | "redirected" | "success" | "incomplete" | "timeout" | "error";
  response_status?: "success" | "redirected" | "incomplete" | "timeout" | "error";
  retrieved_chunk_ids: string[];
  retrieved_chunk_metadata: Array<{
    chunkId: string;
    sourceId: string;
    sourceType: string;
    chunkIndex: number;
    chunkCount?: number;
    documentChunkIndex?: number;
    documentChunkCount?: number;
    score?: number;
  }>;
  assistant_response: string;
  timestamp: string;
  response_length: number;
  interaction_count: number;
  session_duration_ms: number;
  query_type_label?: string;
  user_query_type?: string;
  detected_support_mode?: string;
  feedback_target?: string | null;
  redirect_reason?: string;
  input_origin?: "typed" | "quick_reply" | "prefill_edited";
  source_condition?: "static" | "dynamic";
  support_condition?: "ai" | "non_ai";
  task_id?: string;
  episode_id?: string;
  researcher_code?: string | null;
  source_types_used?: string[];
  visual_assets_used?: string[];
  incomplete_reason?: string;
  retrieval_executed?: boolean;
  retrieval_reason?: string | null;
  retrieval_skipped_reason?: string | null;
  source_context_strategy?: "none" | "canonical" | "targeted_rag" | "canonical_plus_rag";
  detected_functions?: string[];
  primary_detected_function?: string | null;
  secondary_detected_functions?: string[];
  ghostwriting_boundary_triggered?: boolean;
  intent?: string;
  request_is_explicit?: boolean;
  requires_source_context?: boolean;
  requires_task_context?: boolean;
  story_request_mode?: "factual" | "interpretive" | "generative" | null;
  requires_exact_fact?: boolean | null;
  response_mode?: "factual_answer" | "cautious_interpretation" | "idea_options" | "standard";
  conversation_operation?:
    | "new_request"
    | "continue_previous"
    | "translate_previous"
    | "simplify_previous"
    | "clarify_previous"
    | "complete_missing_answer"
    | "accept_previous_offer"
    | "repair_previous_omission"
    | "reject_previous_suggestion"
    | "correct_previous_interpretation"
    | "proofread_draft"
    | "acknowledge_user_inference"
    | "adjust_assistant_behavior"
    | "continuation_structure"
    | "none";
  classifier_confidence?: number;
  scope_limitations?: string[];
  sub_request_count?: number;
  selected_task_rule_id?: string | null;
  fallback_state?:
    | "genuine_draft_only"
    | "recognized_question_missing_context"
    | "clarification_needed"
    | null;
  recognized_story_entity?: string | null;
  planner_dialogue_act?: string;
  planner_conversation_operation?: string;
  planner_requested_outputs?: string[];
  planner_resolved_references?: string[];
  planner_source_needed?: boolean;
  planner_source_strategy?: "none" | "canonical" | "targeted_rag" | "canonical_plus_rag";
  planner_active_direction?: string | null;
  planner_status?: "ok" | "fallback";
  planner_latency_ms?: number;
  planner_fallback_reason?: string | null;
  planner_progress_push_allowed?: boolean;
  planner_style_updates?: string[];
  planner_selected_option_index?: number | null;
  planner_selected_option_meaning?: string | null;
};

export type SessionTranscriptEntry = {
  participant_id: string;
  session_id: string;
  ep_id: string;
  condition_label: string;
  source_condition?: "static" | "dynamic";
  support_condition?: "ai" | "non_ai";
  task_id?: string;
  episode_id?: string;
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

function toLegacyTaskId(epId: string): string {
  if (epId === "ep1") {
    return "task1";
  }

  if (epId === "ep2") {
    return "task2";
  }

  return epId;
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  return error.message;
}

function shouldRetryWithLegacyTaskId(error: unknown): boolean {
  const message = errorMessage(error);
  return message.includes("ep_id") || message.includes("task_id");
}

function isSupabaseSchemaMismatch(error: unknown): boolean {
  return /schema cache|could not find|column|does not exist|pgrst204|pgrst/i.test(
    errorMessage(error)
  );
}

export function buildChatLogPayload(
  entry: ChatLogEntry,
  useLegacyTaskId = false,
  compatibilityMode = false
): object {
  const basePayload = {
    participant_id: entry.participant_id,
    session_id: entry.session_id,
    ...(useLegacyTaskId
      ? { task_id: toLegacyTaskId(entry.ep_id) }
      : { ep_id: entry.ep_id }),
    condition_label: entry.condition_label,
    selected_category: entry.selected_category,
    raw_user_query: entry.raw_user_query,
    policy_decision: entry.policy_decision,
    status: entry.status,
    retrieved_chunk_ids: entry.retrieved_chunk_ids,
    retrieved_chunk_metadata: entry.retrieved_chunk_metadata,
    assistant_response: entry.assistant_response,
    timestamp: entry.timestamp,
    response_length: entry.response_length,
    interaction_count: entry.interaction_count,
    session_duration_ms: entry.session_duration_ms,
    query_type_label: entry.query_type_label,
    redirect_reason: entry.redirect_reason,
    source_types_used: entry.source_types_used || [],
    visual_assets_used: entry.visual_assets_used || [],
  };

  if (compatibilityMode) {
    return basePayload;
  }

  return {
    ...basePayload,
    policy_reason: entry.policy_reason ?? entry.redirect_reason ?? null,
    response_status: entry.response_status,
    user_query_type: entry.user_query_type || entry.detected_support_mode || entry.query_type_label,
    detected_support_mode: entry.detected_support_mode,
    feedback_target: entry.feedback_target ?? null,
    input_origin: entry.input_origin || "typed",
    source_condition: entry.source_condition,
    support_condition: entry.support_condition || "ai",
    task_id: entry.task_id,
    episode_id: entry.episode_id || entry.ep_id,
    researcher_code: entry.researcher_code ?? null,
    incomplete_reason: entry.incomplete_reason,
    retrieval_executed: entry.retrieval_executed,
    retrieval_reason: entry.retrieval_reason ?? null,
    retrieval_skipped_reason: entry.retrieval_skipped_reason ?? null,
    source_context_strategy: entry.source_context_strategy,
    detected_functions: entry.detected_functions || [],
    primary_detected_function: entry.primary_detected_function ?? null,
    secondary_detected_functions: entry.secondary_detected_functions || [],
    ghostwriting_boundary_triggered: entry.ghostwriting_boundary_triggered ?? false,
    intent: entry.intent,
    request_is_explicit: entry.request_is_explicit,
    requires_source_context: entry.requires_source_context,
    requires_task_context: entry.requires_task_context,
    story_request_mode: entry.story_request_mode ?? null,
    requires_exact_fact: entry.requires_exact_fact ?? null,
    response_mode: entry.response_mode ?? null,
    conversation_operation: entry.conversation_operation,
    classifier_confidence: entry.classifier_confidence,
    scope_limitations: entry.scope_limitations || [],
    sub_request_count: entry.sub_request_count,
    selected_task_rule_id: entry.selected_task_rule_id ?? null,
    fallback_state: entry.fallback_state ?? null,
    recognized_story_entity: entry.recognized_story_entity ?? null,
    planner_dialogue_act: entry.planner_dialogue_act,
    planner_conversation_operation: entry.planner_conversation_operation,
    planner_requested_outputs: entry.planner_requested_outputs || [],
    planner_resolved_references: entry.planner_resolved_references || [],
    planner_source_needed: entry.planner_source_needed,
    planner_source_strategy: entry.planner_source_strategy,
    planner_active_direction: entry.planner_active_direction ?? null,
    planner_status: entry.planner_status,
    planner_latency_ms: entry.planner_latency_ms,
    planner_fallback_reason: entry.planner_fallback_reason ?? null,
    planner_progress_push_allowed: entry.planner_progress_push_allowed,
    planner_style_updates: entry.planner_style_updates || [],
    planner_selected_option_index: entry.planner_selected_option_index ?? null,
    planner_selected_option_meaning: entry.planner_selected_option_meaning ?? null,
  };
}

export function buildSessionTranscriptPayload(
  entry: SessionTranscriptEntry,
  useLegacyTaskId = false,
  compatibilityMode = false
): object {
  const basePayload = {
    participant_id: entry.participant_id,
    session_id: entry.session_id,
    ...(useLegacyTaskId
      ? { task_id: toLegacyTaskId(entry.ep_id) }
      : { ep_id: entry.ep_id }),
    condition_label: entry.condition_label,
    timestamp: entry.timestamp,
    interaction_count: entry.interaction_count,
    session_duration_ms: entry.session_duration_ms,
    transcript: entry.transcript,
  };

  if (compatibilityMode) {
    return basePayload;
  }

  return {
    ...basePayload,
    source_condition: entry.source_condition,
    support_condition: entry.support_condition || "ai",
    task_id: entry.task_id,
    episode_id: entry.episode_id || entry.ep_id,
  };
}

export async function appendChatLog(entry: ChatLogEntry): Promise<void> {
  if (hasSupabaseConfig()) {
    try {
      await insertIntoSupabase(CHAT_EVENTS_TABLE, buildChatLogPayload(entry));
      return;
    } catch (error) {
      if (isSupabaseSchemaMismatch(error)) {
        try {
          await insertIntoSupabase(CHAT_EVENTS_TABLE, buildChatLogPayload(entry, false, true));
          return;
        } catch (compatibilityError) {
          if (shouldRetryWithLegacyTaskId(compatibilityError)) {
            try {
              await insertIntoSupabase(
                CHAT_EVENTS_TABLE,
                buildChatLogPayload(entry, true, true)
              );
              return;
            } catch (legacyCompatibilityError) {
              appendLocalFallback(LOG_FILE, entry, legacyCompatibilityError);
              return;
            }
          }

          appendLocalFallback(LOG_FILE, entry, compatibilityError);
          return;
        }
      }

      if (shouldRetryWithLegacyTaskId(error)) {
        try {
          await insertIntoSupabase(CHAT_EVENTS_TABLE, buildChatLogPayload(entry, true));
          return;
        } catch (legacyError) {
          if (isSupabaseSchemaMismatch(legacyError)) {
            try {
              await insertIntoSupabase(
                CHAT_EVENTS_TABLE,
                buildChatLogPayload(entry, true, true)
              );
              return;
            } catch (legacyCompatibilityError) {
              appendLocalFallback(LOG_FILE, entry, legacyCompatibilityError);
              return;
            }
          }

          appendLocalFallback(LOG_FILE, entry, legacyError);
          return;
        }
      }

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
      await insertIntoSupabase(SESSION_TRANSCRIPTS_TABLE, buildSessionTranscriptPayload(entry));
      return;
    } catch (error) {
      if (isSupabaseSchemaMismatch(error)) {
        try {
          await insertIntoSupabase(
            SESSION_TRANSCRIPTS_TABLE,
            buildSessionTranscriptPayload(entry, false, true)
          );
          return;
        } catch (compatibilityError) {
          if (shouldRetryWithLegacyTaskId(compatibilityError)) {
            try {
              await insertIntoSupabase(
                SESSION_TRANSCRIPTS_TABLE,
                buildSessionTranscriptPayload(entry, true, true)
              );
              return;
            } catch (legacyCompatibilityError) {
              appendLocalFallback(SESSION_TRANSCRIPT_FILE, entry, legacyCompatibilityError);
              return;
            }
          }

          appendLocalFallback(SESSION_TRANSCRIPT_FILE, entry, compatibilityError);
          return;
        }
      }

      if (shouldRetryWithLegacyTaskId(error)) {
        try {
          await insertIntoSupabase(
            SESSION_TRANSCRIPTS_TABLE,
            buildSessionTranscriptPayload(entry, true)
          );
          return;
        } catch (legacyError) {
          if (isSupabaseSchemaMismatch(legacyError)) {
            try {
              await insertIntoSupabase(
                SESSION_TRANSCRIPTS_TABLE,
                buildSessionTranscriptPayload(entry, true, true)
              );
              return;
            } catch (legacyCompatibilityError) {
              appendLocalFallback(SESSION_TRANSCRIPT_FILE, entry, legacyCompatibilityError);
              return;
            }
          }

          appendLocalFallback(SESSION_TRANSCRIPT_FILE, entry, legacyError);
          return;
        }
      }

      appendLocalFallback(SESSION_TRANSCRIPT_FILE, entry, error);
      return;
    }
  }

  appendLocalLog(SESSION_TRANSCRIPT_FILE, entry);
}
