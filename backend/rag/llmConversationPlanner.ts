import OpenAI from "openai";
import type { TaskCondition, TaskId } from "./loader.ts";
import {
  planConversationTurn,
  type ConversationPlannerOutput,
  type PlannerConversationOperation,
  type PlannerDialogueAct,
  type PlannerSourceStrategy,
} from "./conversationPlanner.ts";
import type { ConversationMemory, RecentMessage } from "./conversationMemory.ts";

type PlannerParams = {
  client: OpenAI | null;
  model: string;
  query: string;
  taskId: TaskId;
  condition: TaskCondition;
  recentMessages: RecentMessage[];
  conversationMemory: ConversationMemory;
  responseStylePreferences?: string[];
  timeoutMs: number;
  enabled: boolean;
};

const DIALOGUE_ACTS: PlannerDialogueAct[] = [
  "new_writing_request",
  "source_question",
  "draft_submission",
  "feedback_request",
  "select_previous_option",
  "accept_previous_offer",
  "reject_previous_suggestion",
  "correct_previous_interpretation",
  "complete_missing_answer",
  "acknowledgment_or_inference",
  "assistant_directed_feedback",
  "request_task_progression",
  "confusion_or_restatement",
  "social_response",
];

const CONVERSATION_OPERATIONS: PlannerConversationOperation[] = [
  "new_request",
  "continue_previous",
  "complete_missing_answer",
  "accept_previous_offer",
  "repair_previous_omission",
  "reject_previous_suggestion",
  "correct_previous_interpretation",
  "acknowledge_user_inference",
  "adjust_assistant_behavior",
  "continuation_structure",
  "proofread_draft",
  "none",
];

const SOURCE_STRATEGIES: PlannerSourceStrategy[] = [
  "none",
  "canonical",
  "targeted_rag",
  "canonical_plus_rag",
];

const RESPONSE_SCOPES = [
  "direct_answer",
  "concise_support",
  "full_support",
  "clarification",
];

function recentRawTurns(recentMessages: RecentMessage[]): string {
  return recentMessages
    .slice(-8)
    .map((message) => `${message.role.toUpperCase()}:\n${message.text}`)
    .join("\n\n---\n\n");
}

function previousMessage(recentMessages: RecentMessage[], role: RecentMessage["role"]): string {
  return [...recentMessages].reverse().find((message) => message.role === role)?.text || "";
}

function buildPlannerInput(params: PlannerParams, localPlan: ConversationPlannerOutput): string {
  return [
    "Plan the next response for My Writing Assistant. Return only the structured JSON.",
    "",
    `CURRENT_TASK: ${params.taskId}`,
    `CURRENT_CONDITION: ${params.condition}`,
    "",
    "CURRENT_USER_MESSAGE:",
    params.query,
    "",
    "IMMEDIATELY_PREVIOUS_USER_MESSAGE:",
    previousMessage(params.recentMessages, "user") || "(none)",
    "",
    "IMMEDIATELY_PREVIOUS_ASSISTANT_MESSAGE:",
    previousMessage(params.recentMessages, "assistant") || "(none)",
    "",
    "RECENT_RAW_TURNS:",
    recentRawTurns(params.recentMessages) || "(none)",
    "",
    "COMPACT_CONVERSATION_STATE:",
    JSON.stringify({
      workingContext: params.conversationMemory.workingContext,
      activeSupportContext: params.conversationMemory.activeSupportContext,
      activeEntities: params.conversationMemory.activeEntities,
      activeScene: params.conversationMemory.activeScene,
      lastUserFocus: params.conversationMemory.lastUserFocus,
      continuationFocus: params.conversationMemory.continuationFocus,
      responseStylePreferences: params.responseStylePreferences || [],
    }),
    "",
    "LOCAL_FALLBACK_PLAN:",
    JSON.stringify(localPlan),
    "",
    "Rules:",
    "- Resolve ordinal and semantic references to the immediately previous option list.",
    "- Resolve acceptance of a previous assistant offer from the immediately previous assistant message.",
    "- Treat assistant-directed criticism as meta-feedback, not learner writing.",
    "- Do not use source context for vocabulary, grammar, proofreading, previous-option selection, previous-offer acceptance, or meta-feedback.",
    "- Use canonical source context for broad source/story questions and source compatibility.",
    "- Use targeted_rag only for exact image/video/audio/caption/visual-position evidence.",
    "- Keep requested_outputs as an array; do not collapse mixed requests into one intent.",
    "- Ask clarification only when the current reference genuinely cannot be resolved.",
  ].join("\n");
}

const plannerSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "dialogue_act",
    "conversation_operation",
    "current_goal",
    "resolved_references",
    "requested_outputs",
    "selected_previous_option",
    "active_learner_direction",
    "accepted_suggestions",
    "rejected_directions",
    "unanswered_items",
    "source_needed",
    "source_strategy",
    "source_reason",
    "response_scope",
    "clarification_needed",
    "progress_push_allowed",
    "style_updates",
    "confidence",
  ],
  properties: {
    dialogue_act: { type: "string", enum: DIALOGUE_ACTS },
    conversation_operation: { type: "string", enum: CONVERSATION_OPERATIONS },
    current_goal: { type: "string" },
    resolved_references: { type: "array", items: { type: "string" } },
    requested_outputs: { type: "array", items: { type: "string" } },
    selected_previous_option: {
      type: "object",
      additionalProperties: false,
      required: ["index", "meaning"],
      properties: {
        index: { type: "number" },
        meaning: { type: "string" },
      },
    },
    active_learner_direction: { type: "string" },
    accepted_suggestions: { type: "array", items: { type: "string" } },
    rejected_directions: { type: "array", items: { type: "string" } },
    unanswered_items: { type: "array", items: { type: "string" } },
    source_needed: { type: "boolean" },
    source_strategy: { type: "string", enum: SOURCE_STRATEGIES },
    source_reason: { type: "string" },
    response_scope: { type: "string", enum: RESPONSE_SCOPES },
    clarification_needed: { type: "boolean" },
    progress_push_allowed: { type: "boolean" },
    style_updates: { type: "array", items: { type: "string" } },
    confidence: { type: "number" },
  },
} as const;

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeLlmPlan(value: unknown, localPlan: ConversationPlannerOutput): ConversationPlannerOutput {
  const candidate = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const selected = typeof candidate.selected_previous_option === "object" && candidate.selected_previous_option !== null
    ? candidate.selected_previous_option as Record<string, unknown>
    : {};
  const selectedIndex = typeof selected.index === "number" && selected.index > 0 ? selected.index : null;
  const selectedMeaning = typeof selected.meaning === "string" && selected.meaning ? selected.meaning : null;
  const dialogueAct = DIALOGUE_ACTS.includes(candidate.dialogue_act as PlannerDialogueAct)
    ? candidate.dialogue_act as PlannerDialogueAct
    : localPlan.dialogue_act;
  const operation = CONVERSATION_OPERATIONS.includes(candidate.conversation_operation as PlannerConversationOperation)
    ? candidate.conversation_operation as PlannerConversationOperation
    : localPlan.conversation_operation;
  const sourceStrategy = SOURCE_STRATEGIES.includes(candidate.source_strategy as PlannerSourceStrategy)
    ? candidate.source_strategy as PlannerSourceStrategy
    : localPlan.source_strategy;
  const responseScope = RESPONSE_SCOPES.includes(candidate.response_scope as string)
    ? candidate.response_scope as ConversationPlannerOutput["response_scope"]
    : localPlan.response_scope;
  const confidence = typeof candidate.confidence === "number"
    ? Math.max(0, Math.min(1, candidate.confidence))
    : localPlan.confidence;

  return {
    ...localPlan,
    dialogue_act: localPlan.selected_option_index ? localPlan.dialogue_act : dialogueAct,
    conversation_operation: localPlan.selected_option_index ? localPlan.conversation_operation : operation,
    current_goal: typeof candidate.current_goal === "string" && candidate.current_goal ? candidate.current_goal : localPlan.current_goal,
    resolved_references: asStringArray(candidate.resolved_references).length
      ? asStringArray(candidate.resolved_references)
      : localPlan.resolved_references,
    requested_outputs: asStringArray(candidate.requested_outputs).length
      ? asStringArray(candidate.requested_outputs)
      : localPlan.requested_outputs,
    active_learner_direction:
      localPlan.active_learner_direction ||
      (typeof candidate.active_learner_direction === "string" && candidate.active_learner_direction
        ? candidate.active_learner_direction
        : null),
    accepted_suggestions: localPlan.accepted_suggestions.length
      ? localPlan.accepted_suggestions
      : asStringArray(candidate.accepted_suggestions),
    rejected_directions: localPlan.rejected_directions.length
      ? localPlan.rejected_directions
      : asStringArray(candidate.rejected_directions),
    unanswered_items: localPlan.unanswered_items.length
      ? localPlan.unanswered_items
      : asStringArray(candidate.unanswered_items),
    source_needed: typeof candidate.source_needed === "boolean" ? candidate.source_needed : localPlan.source_needed,
    source_strategy: sourceStrategy,
    source_reason: typeof candidate.source_reason === "string" && candidate.source_reason
      ? candidate.source_reason
      : localPlan.source_reason,
    response_scope: responseScope,
    clarification_needed: typeof candidate.clarification_needed === "boolean"
      ? candidate.clarification_needed
      : localPlan.clarification_needed,
    progress_push_allowed: typeof candidate.progress_push_allowed === "boolean"
      ? candidate.progress_push_allowed
      : localPlan.progress_push_allowed,
    style_updates: localPlan.style_updates.length ? localPlan.style_updates : asStringArray(candidate.style_updates),
    planner_status: "llm",
    selected_option_index: localPlan.selected_option_index || selectedIndex,
    selected_option_meaning: localPlan.selected_option_meaning || selectedMeaning,
    confidence,
    planner_error_type: null,
    fallback_used: false,
  };
}

export async function planConversationTurnWithFallback(
  params: PlannerParams
): Promise<ConversationPlannerOutput> {
  const started = Date.now();
  const localPlan = planConversationTurn({
    query: params.query,
    taskId: params.taskId,
    recentMessages: params.recentMessages,
  });

  if (!params.enabled || !params.client) {
    return localPlan;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs);

  try {
    const response = await params.client.responses.create(
      {
        model: params.model,
        instructions: "You are a semantic conversation planner. Return strict JSON matching the schema. Do not write learner-facing text.",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: buildPlannerInput(params, localPlan),
              },
            ],
          },
        ],
        max_output_tokens: 900,
        text: {
          format: {
            type: "json_schema",
            name: "conversation_plan",
            strict: true,
            schema: plannerSchema,
          },
        },
      },
      { signal: controller.signal }
    );
    const raw = response.output_text || "{}";
    const parsed = JSON.parse(raw);
    const plan = normalizeLlmPlan(parsed, localPlan);

    return {
      ...plan,
      planner_latency_ms: Date.now() - started,
    };
  } catch (error) {
    return {
      ...localPlan,
      planner_status: "fallback",
      planner_latency_ms: Date.now() - started,
      fallback_reason: error instanceof Error ? error.message : String(error),
      planner_error_type: error instanceof Error ? error.name || "llm_planner_error" : "llm_planner_error",
      fallback_used: true,
    };
  } finally {
    clearTimeout(timeout);
  }
}
