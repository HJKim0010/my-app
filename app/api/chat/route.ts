import { NextRequest } from "next/server";
import OpenAI from "openai";
import {
  analyzeQueryScope,
  type FeedbackTarget,
  type SupportModeLabel,
} from "@/backend/policy/classifier";
import { redirectResponse } from "@/backend/policy/redirect";
import { appendChatLog, type ChatLogEntry } from "@/backend/logs/logger";
import { resolveVisualInputs } from "@/backend/rag/assetResolver";
import {
  buildConversationMemory,
  type RecentMessage,
} from "@/backend/rag/conversationMemory";
import { loadTaskPackage, type TaskCondition, type TaskId } from "@/backend/rag/loader";
import {
  buildSystemInstruction,
  buildUserInput,
  detectResponseLanguage,
  detectSupportMode,
  type ResponseLanguage,
  type SupportMode,
} from "@/backend/rag/promptBuilder";
import { retrieveTaskChunks } from "@/backend/rag/retriever";

export const maxDuration = 60;

type QuickReply = {
  label: string;
  value?: string;
  action?: "send" | "prefill" | "focus";
};

type ChatApiResponse = {
  ok: boolean;
  requestId: string;
  status: "success" | "redirected" | "incomplete" | "timeout" | "error";
  text: string;
  reason: string | null;
  quickReplies: QuickReply[];
};

type AssistantDraftResponse = {
  text: string;
  quickReplies?: QuickReply[];
};

function sanitizeAssistantResponse(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const KOREAN_ACKNOWLEDGMENT_PATTERN =
  /^(?:\u3147\u3147|\u3147\u3147\??|\uc751|\uc751\??|\ub124|\ub137|\uc608|\uadf8\ub798|\uc88b\uc544|\uc88b\uc544\uc694|\uc54c\uaca0\uc5b4|\uc54c\uaca0\uc5b4\uc694|\uc624\ucf00\uc774|\uc624\ud0a4)$/i;
const PURE_SHORT_PUNCTUATION_PATTERN = /^[?!.~,/\\]+$/;

function isShortAcknowledgment(query: string): boolean {
  const normalized = compactText(query);
  return /^(yes|yeah|yep|ok|okay|sure|right|got it)$/i.test(normalized)
    || KOREAN_ACKNOWLEDGMENT_PATTERN.test(normalized);
}

function isAmbiguousShortReaction(query: string): boolean {
  const normalized = compactText(query);

  if (!normalized || normalized.length > 12) {
    return false;
  }

  return /^(what\?|huh\?|hm\?|hmm\?)$/i.test(normalized)
    || /^(뭐라고|뭐라고\?|무슨 뜻|헐|음|응\?|ㅇㅇ)[!?.~\s]*$/i.test(normalized)
    || PURE_SHORT_PUNCTUATION_PATTERN.test(normalized);
}

function isGreeting(query: string): boolean {
  const normalized = compactText(query).toLowerCase();

  if (!normalized || normalized.length > 40) {
    return false;
  }

  return /^(hi|hello|hey|good morning|good afternoon|good evening)[!?.~\s]*$/i.test(normalized)
    || /^(\uc548\ub155|\uc548\ub155\ud558\uc138\uc694|\ud558\uc774|\ud5ec\ub85c)[!?.~\s]*$/.test(normalized);
}

function containsGreeting(query: string): boolean {
  const normalized = compactText(query).toLowerCase();
  return /(?:^|\s)(hi|hello|hey|good morning|good afternoon|good evening)(?:[!?.~,\s]|$)/i.test(normalized)
    || /(?:^|\s)(\uc548\ub155|\uc548\ub155\ud558\uc138\uc694|\ud558\uc774|\ud5ec\ub85c)(?:[!?.~,\s]|$)/.test(normalized);
}

function isVagueHelpRequest(query: string): boolean {
  const normalized = compactText(query).toLowerCase();

  if (normalized.length > 80) {
    return false;
  }

  return /(help|help me|can you help|this part|which part|what part|\ub3c4\uc640\uc904|\ub3c4\uc640\uc8fc|\uc774\s*\ubd80\ubd84|\uc5b4\ub290\s*\ubd80\ubd84|\ubb50\ub97c\s*\ub3c4\uc640)/i.test(normalized);
}

function isMetaCapabilityQuestion(query: string): boolean {
  const normalized = compactText(query).toLowerCase();

  if (!normalized || normalized.length > 90) {
    return false;
  }

  return (
    /(can you understand|do you understand|understand me|understand what i say|will you understand|can you follow|can you keep up)/i.test(
      normalized
    ) ||
    /(내가\s*하는\s*말|내\s*말|제가\s*하는\s*말).*(이해|알아듣|알아\s*들|알겠)/.test(
      normalized
    ) ||
    /(잘\s*)?(이해할|알아들을)\s*수\s*있/.test(normalized)
  );
}

function shouldAskTargetClarification(
  query: string,
  mode: SupportMode,
  hasChunks: boolean,
  workingContext: "source" | "user_continuation"
): boolean {
  const normalized = compactText(query).toLowerCase();

  if (workingContext === "user_continuation") {
    return false;
  }

  if (hasChunks) {
    return false;
  }

  if (mode === "comprehension") {
    return normalized.length < 20;
  }

  return false;
}

function shouldAskForUserDraftBeforeSource(
  query: string,
  workingContext: "source" | "user_continuation"
): boolean {
  if (workingContext !== "user_continuation") {
    return false;
  }

  const normalized = compactText(query);
  if (normalized.length >= 80) {
    return false;
  }

  return /(내 글|내 작문|내 라이팅|내 초안|my writing|my draft|what i wrote)/i.test(normalized);
}

function emptyQuickReplies(payload: Partial<ChatApiResponse>): ChatApiResponse {
  return {
    ok: payload.ok ?? true,
    requestId: payload.requestId ?? crypto.randomUUID(),
    status: payload.status ?? "success",
    text: payload.text ?? "",
    reason: payload.reason ?? null,
    quickReplies: [],
  };
}

function chatJsonResponse(payload: Partial<ChatApiResponse>, status = 200): Response {
  const normalized = emptyQuickReplies(payload);
  return Response.json(normalized, { status });
}

function participantErrorMessage(language: ResponseLanguage): string {
  return language === "english"
    ? "I could not make a reply just now. Please try once more."
    : "잠시 응답을 만들지 못했어요. 한 번만 다시 시도해 주세요.";
}

function mapSupportModeForLog(mode: SupportMode): SupportModeLabel {
  if (mode === "ideas") return "idea_generation";
  if (mode === "language") return "vocabulary_expression";
  if (mode === "feedback") return "feedback_checking";
  return mode;
}

function responseFromText(
  text: string,
  requestId: string,
  status: ChatApiResponse["status"] = "success",
  reason: string | null = null,
  quickReplies: QuickReply[] = []
): ChatApiResponse {
  void quickReplies;
  return { ok: status === "success" || status === "redirected", requestId, status, text, reason, quickReplies: [] };
}

function confirmationQuickReplies(_language: ResponseLanguage): QuickReply[] {
  void _language;
  return [];
}

function supportChoiceQuickReplies(_language: ResponseLanguage): QuickReply[] {
  void _language;
  return [];
}

function buildAmbiguousReactionResponseV2(language: ResponseLanguage): AssistantDraftResponse {
  if (language === "english") {
    return {
      text: "I am not fully sure what you mean yet. Did you mean my last answer was unclear?",
      quickReplies: confirmationQuickReplies(language),
    };
  }

  return {
    text: "아직 뜻을 정확히 잡기 어려워요. 방금 답변이 헷갈렸다는 뜻인가요?",
    quickReplies: confirmationQuickReplies(language),
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildGreetingResponseV2(language: ResponseLanguage): AssistantDraftResponse {
  if (language === "english") {
    return {
      text: "Hello. What would you like help with?",
      quickReplies: supportChoiceQuickReplies(language),
    };
  }

  return {
    text: "안녕하세요. 글쓰기에서 어떤 도움을 받고 싶나요?",
    quickReplies: supportChoiceQuickReplies(language),
  };
}

function buildGreetingClarificationResponse(language: ResponseLanguage): AssistantDraftResponse {
  if (language === "english") {
    return {
      text: "Hello. Which part would you like help with? You can tap a quick bubble below or type your question directly.",
    };
  }

  return {
    text: "안녕하세요. 어떤 부분을 도와드릴까요? 질문을 직접 입력해도 좋아요.",
  };
}

function buildCalmGreetingResponse(language: ResponseLanguage): AssistantDraftResponse {
  if (language === "english") {
    return {
      text: "Hello. What would you like help with? You can tap a quick bubble below or type your question directly.",
    };
  }

  return {
    text: "안녕하세요. 어떤 부분을 도와드릴까요? 질문을 직접 입력해도 좋아요.",
  };
}

function buildAcknowledgmentFollowUpV2(language: ResponseLanguage): AssistantDraftResponse {
  if (language === "english") {
    return {
      text: "I understand. What would you like next?",
      quickReplies: supportChoiceQuickReplies(language),
    };
  }

  return {
    text: "좋아요. 다음에는 어떤 도움을 받을까요?",
    quickReplies: supportChoiceQuickReplies(language),
  };
}

function buildMetaCapabilityResponse(language: ResponseLanguage): AssistantDraftResponse {
  if (language === "english") {
    return {
      text:
        "Yes, I can follow what you say. If something is unclear, I will ask a short question instead of guessing. You can ask in Korean, English, or both.",
    };
  }

  return {
    text:
      "네, 이해할 수 있어요. 다만 뜻이 애매하면 제가 넘겨짚지 않고 짧게 확인 질문을 할게요. 한국어, 영어, 섞어서 질문해도 괜찮아요.",
  };
}

function buildTargetClarificationResponseV2(
  language: ResponseLanguage,
  mode: SupportMode
): AssistantDraftResponse {
  if (language === "english") {
    if (mode === "comprehension") {
      return {
        text: "Which part should I explain first? Choose one or type the part yourself.",
        quickReplies: [
          { label: "Scene", value: "Please explain this scene: ", action: "prefill" },
          { label: "Object", value: "Please explain this object: ", action: "prefill" },
          { label: "I'll type", action: "focus" },
        ],
      };
    }

    return {
      text: "Please show me one short part of your idea or draft first, and I will help from there.",
      quickReplies: confirmationQuickReplies(language),
    };
  }

  if (mode === "comprehension") {
    return {
      text: "어느 부분을 설명하면 좋을까요? 장면, 행동, 물건, 문장 중 하나를 알려주세요.",
      quickReplies: [],
    };
  }

  return {
    text: "아이디어나 초안의 짧은 부분을 먼저 보여주세요. 그 부분부터 같이 살펴볼게요.",
    quickReplies: confirmationQuickReplies(language),
  };
}

function buildNoChunkResponseV2(
  mode: SupportMode,
  language: ResponseLanguage,
  workingContext: "source" | "user_continuation"
): AssistantDraftResponse {
  if (language === "english") {
    if (workingContext === "user_continuation") {
      return {
        text:
          mode === "feedback"
            ? "I need one short part of your continuation or draft to give feedback."
            : "I need one short part of your continuation idea first.",
        quickReplies: confirmationQuickReplies(language),
      };
    }

    return {
      text: "I need one clearer target first. Which part should we focus on?",
      quickReplies: [
        { label: "Scene", value: "Please help me with this scene: ", action: "prefill" },
        { label: "Clue", value: "Please help me with this clue: ", action: "prefill" },
        { label: "I'll type", action: "focus" },
      ],
    };
  }

  if (workingContext === "user_continuation") {
    return {
        text:
          mode === "feedback"
            ? "피드백을 하려면 이어쓰기 초안의 짧은 부분이 필요해요."
            : "먼저 이어쓰기 아이디어나 초안의 짧은 부분을 보여주세요.",
      quickReplies: confirmationQuickReplies(language),
    };
  }

  return {
    text: "먼저 어떤 부분을 보고 싶은지 알려주세요. 장면, 단서, 행동, 문장 중 하나를 골라도 좋아요.",
    quickReplies: [],
  };
}

async function persistChatLog(entry: ChatLogEntry): Promise<void> {
  await appendChatLog(entry).catch((error) => {
    console.error("Failed to persist chat log", error);
  });
}

function normalizeParticipantId(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/\s+/g, "-").toUpperCase();
}

function isValidParticipantId(value: string): boolean {
  return /^[A-Z0-9_-]{2,40}$/.test(value);
}

function toEpId(taskId: TaskId): "ep1" | "ep2" {
  return taskId === "task2" ? "ep2" : "ep1";
}

function buildCommonLogFields(params: {
  participantId: string;
  sessionId: string;
  epId: "ep1" | "ep2";
  taskId: TaskId;
  condition: TaskCondition;
  conditionLabel: string;
  category: string;
  query: string;
  policyDecision: string;
  policyReason: string | null;
  inputOrigin: "typed" | "quick_reply" | "prefill_edited";
  detectedSupportMode: string;
  feedbackTarget: FeedbackTarget;
  timestamp: string;
  interactionCount: number;
  sessionDurationMs: number;
}): Pick<
  ChatLogEntry,
  | "participant_id"
  | "session_id"
  | "ep_id"
  | "task_id"
  | "episode_id"
  | "condition_label"
  | "selected_category"
  | "raw_user_query"
  | "policy_decision"
  | "policy_reason"
  | "input_origin"
  | "source_condition"
  | "support_condition"
  | "detected_support_mode"
  | "user_query_type"
  | "feedback_target"
  | "timestamp"
  | "interaction_count"
  | "session_duration_ms"
  | "researcher_code"
> {
  return {
    participant_id: params.participantId,
    session_id: params.sessionId,
    ep_id: params.epId,
    task_id: params.taskId,
    episode_id: params.epId,
    condition_label: params.conditionLabel,
    selected_category: params.category,
    raw_user_query: params.query,
    policy_decision: params.policyDecision,
    policy_reason: params.policyReason,
    input_origin: params.inputOrigin,
    source_condition: params.condition,
    support_condition: "ai",
    detected_support_mode: params.detectedSupportMode,
    user_query_type: params.detectedSupportMode,
    feedback_target: params.feedbackTarget,
    timestamp: params.timestamp,
    interaction_count: params.interactionCount,
    session_duration_ms: params.sessionDurationMs,
    researcher_code: null,
  };
}

export async function POST(request: NextRequest) {
  let query = "";
  let category = "Others";
  let taskId: TaskId = "task1";
  let condition: TaskCondition = "static";
  let sessionId = "unknown-session";
  let participantId = "";
  let interactionCount = 1;
  let sessionStartedAt = Date.now();
  let recentMessages: RecentMessage[] = [];
  let inputOrigin: "typed" | "quick_reply" | "prefill_edited" = "typed";
  const requestId = crypto.randomUUID();

  try {
    const body = await request.json();
    query = typeof body?.query === "string" ? body.query : "";
    category = typeof body?.category === "string" ? body.category : category;
    taskId = body?.taskId === "task2" ? "task2" : "task1";
    condition = body?.condition === "dynamic" ? "dynamic" : "static";
    sessionId = typeof body?.sessionId === "string" ? body.sessionId : sessionId;
    participantId = normalizeParticipantId(body?.participantId);
    interactionCount =
      typeof body?.interactionCount === "number" ? body.interactionCount : interactionCount;
    sessionStartedAt =
      typeof body?.sessionStartedAt === "number" ? body.sessionStartedAt : sessionStartedAt;
    inputOrigin =
      body?.input_origin === "quick_reply" || body?.input_origin === "prefill_edited"
        ? body.input_origin
        : "typed";
    recentMessages = Array.isArray(body?.recentMessages)
      ? body.recentMessages.filter(
          (message: unknown): message is RecentMessage =>
            typeof message === "object" &&
            message !== null &&
            typeof (message as Record<string, unknown>).text === "string" &&
            (((message as Record<string, unknown>).role as string) === "user" ||
              ((message as Record<string, unknown>).role as string) === "assistant")
        )
      : [];
  } catch {
    query = "";
  }

  if (!query.trim()) {
    return chatJsonResponse(
      responseFromText("Please enter a prompt.", requestId, "error", "empty_query"),
      400
    );
  }

  if (!isValidParticipantId(participantId)) {
    return chatJsonResponse(
      responseFromText(
        "Participant ID is required before starting the chat.",
        requestId,
        "error",
        "invalid_participant_id"
      ),
      400
    );
  }

  const taskPackage = loadTaskPackage(taskId, condition);
  const epId = toEpId(taskId);
  const timestamp = new Date().toISOString();
  const sessionDurationMs = Math.max(0, Date.now() - sessionStartedAt);
  const policyAnalysis = analyzeQueryScope(query);
  const policyDecision = policyAnalysis.queryType;
  const restrictionReason = policyAnalysis.reason;
  const conversationMemory = buildConversationMemory(taskId, query, recentMessages);
  const supportMode = detectSupportMode(query, category, conversationMemory);
  const responseLanguage = detectResponseLanguage(query);
  const hasConversationContext = recentMessages.length > 0;
  const commonLog = buildCommonLogFields({
    participantId,
    sessionId,
    epId,
    taskId,
    condition,
    conditionLabel: taskPackage.config.ai_condition,
    category,
    query,
    policyDecision,
    policyReason: restrictionReason,
    inputOrigin,
    detectedSupportMode:
      policyAnalysis.detectedSupportMode === "other"
        ? mapSupportModeForLog(supportMode)
        : policyAnalysis.detectedSupportMode,
    feedbackTarget: policyAnalysis.feedbackTarget,
    timestamp,
    interactionCount,
    sessionDurationMs,
  });

  if (isMetaCapabilityQuestion(query)) {
    const response = buildMetaCapabilityResponse(responseLanguage);

    await persistChatLog({
      ...commonLog,
      participant_id: participantId,
      session_id: sessionId,
      ep_id: epId,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: "allowed",
      status: "allowed",
      response_status: "success",
      retrieved_chunk_ids: [],
      retrieved_chunk_metadata: [],
      assistant_response: response.text,
      timestamp,
      response_length: response.text.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: "procedural",
      detected_support_mode: "procedural",
      user_query_type: "procedural",
      source_types_used: [],
      visual_assets_used: [],
    });

    return chatJsonResponse(responseFromText(response.text, requestId, "success", null));
  }

  if (containsGreeting(query) && isVagueHelpRequest(query) && !isGreeting(query)) {
    const response = buildGreetingClarificationResponse(responseLanguage);

    await persistChatLog({
      ...commonLog,
      participant_id: participantId,
      session_id: sessionId,
      ep_id: epId,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: "allowed",
      status: "allowed",
      response_status: "success",
      retrieved_chunk_ids: [],
      retrieved_chunk_metadata: [],
      assistant_response: response.text,
      timestamp,
      response_length: response.text.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: "greeting_needs_clarification",
      source_types_used: [],
      visual_assets_used: [],
    });

    return chatJsonResponse(responseFromText(response.text, requestId, "success", null, response.quickReplies));
  }

  if (isGreeting(query)) {
    const response = buildCalmGreetingResponse(responseLanguage);

    await persistChatLog({
      ...commonLog,
      participant_id: participantId,
      session_id: sessionId,
      ep_id: epId,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: "allowed",
      status: "allowed",
      response_status: "success",
      retrieved_chunk_ids: [],
      retrieved_chunk_metadata: [],
      assistant_response: response.text,
      timestamp,
      response_length: response.text.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: "greeting",
      source_types_used: [],
      visual_assets_used: [],
    });

    return chatJsonResponse(responseFromText(response.text, requestId, "success", null, response.quickReplies));
  }

  if (isAmbiguousShortReaction(query) && !hasConversationContext) {
    const response = buildAmbiguousReactionResponseV2(responseLanguage);

    await persistChatLog({
      ...commonLog,
      participant_id: participantId,
      session_id: sessionId,
      ep_id: epId,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: "allowed",
      status: "allowed",
      response_status: "success",
      retrieved_chunk_ids: [],
      retrieved_chunk_metadata: [],
      assistant_response: response.text,
      timestamp,
      response_length: response.text.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: "ambiguous_short_reaction",
      source_types_used: [],
      visual_assets_used: [],
    });

    return chatJsonResponse(responseFromText(response.text, requestId, "success", null, response.quickReplies));
  }

  if (isShortAcknowledgment(query) && !hasConversationContext) {
    const response = buildAcknowledgmentFollowUpV2(responseLanguage);

    await persistChatLog({
      ...commonLog,
      participant_id: participantId,
      session_id: sessionId,
      ep_id: epId,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: "allowed",
      status: "allowed",
      response_status: "success",
      retrieved_chunk_ids: [],
      retrieved_chunk_metadata: [],
      assistant_response: response.text,
      timestamp,
      response_length: response.text.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: "acknowledgment",
      source_types_used: [],
      visual_assets_used: [],
    });

    return chatJsonResponse(responseFromText(response.text, requestId, "success", null, response.quickReplies));
  }

  if (policyDecision === "restricted") {
    const redirected = redirectResponse(
      restrictionReason ?? "sentence_generation",
      responseLanguage,
      query
    );
    const redirectPayload: ChatApiResponse = {
      ok: true,
      requestId,
      status: "redirected",
      text: redirected,
      reason: restrictionReason ?? "sentence_generation",
      quickReplies: [],
    };

    await persistChatLog({
      ...commonLog,
      participant_id: participantId,
      session_id: sessionId,
      ep_id: epId,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: policyDecision,
      policy_reason: restrictionReason ?? "sentence_generation",
      status: "redirected",
      response_status: "redirected",
      retrieved_chunk_ids: [],
      retrieved_chunk_metadata: [],
      assistant_response: redirected,
      timestamp,
      response_length: redirected.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: "restricted",
      redirect_reason: restrictionReason ?? "sentence_generation",
      input_origin: inputOrigin,
      source_condition: condition,
      support_condition: "ai",
      detected_support_mode: "restricted",
      user_query_type: "restricted",
      feedback_target: policyAnalysis.feedbackTarget,
      source_types_used: [],
      visual_assets_used: [],
    });

    return chatJsonResponse(redirectPayload);
  }

  if (shouldAskForUserDraftBeforeSource(query, conversationMemory.workingContext)) {
    const draftNeeded = buildNoChunkResponseV2("feedback", responseLanguage, "user_continuation");

    await persistChatLog({
      ...commonLog,
      participant_id: participantId,
      session_id: sessionId,
      ep_id: epId,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: "allowed",
      status: "allowed",
      response_status: "success",
      retrieved_chunk_ids: [],
      retrieved_chunk_metadata: [],
      assistant_response: draftNeeded.text,
      timestamp,
      response_length: draftNeeded.text.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: "feedback",
      detected_support_mode: "feedback_checking",
      user_query_type: "feedback_checking",
      source_types_used: [],
      visual_assets_used: [],
    });

    return chatJsonResponse(responseFromText(draftNeeded.text, requestId, "success", null));
  }

  const retrievedChunks = retrieveTaskChunks(
    taskId,
    query,
    taskPackage,
    4,
    true,
    conversationMemory
  );

  if (
    shouldAskTargetClarification(
      query,
      supportMode,
      retrievedChunks.length > 0,
      conversationMemory.workingContext
    )
  ) {
    const clarification = buildTargetClarificationResponseV2(responseLanguage, supportMode);

    await persistChatLog({
      participant_id: participantId,
      session_id: sessionId,
      ep_id: epId,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: "allowed",
      status: "allowed",
      retrieved_chunk_ids: [],
      retrieved_chunk_metadata: [],
      assistant_response: clarification.text,
      timestamp,
      response_length: clarification.text.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: "needs_target_clarification",
      source_types_used: [],
      visual_assets_used: [],
    });

    return chatJsonResponse(
      responseFromText(clarification.text, requestId, "success", null, clarification.quickReplies)
    );
  }

  if (
    retrievedChunks.length === 0 &&
    !conversationMemory.isContextualFollowUp &&
    !conversationMemory.activeSupportContext
  ) {
    const boundedResponse = buildNoChunkResponseV2(
      supportMode,
      responseLanguage,
      conversationMemory.workingContext
    );

    await persistChatLog({
      ...commonLog,
      participant_id: participantId,
      session_id: sessionId,
      ep_id: epId,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: "allowed",
      status: "allowed",
      response_status: "success",
      retrieved_chunk_ids: [],
      retrieved_chunk_metadata: [],
      assistant_response: boundedResponse.text,
      timestamp,
      response_length: boundedResponse.text.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: supportMode,
      source_types_used: [],
      visual_assets_used: [],
    });

    return chatJsonResponse(
      responseFromText(boundedResponse.text, requestId, "success", null, boundedResponse.quickReplies)
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    const text = participantErrorMessage(responseLanguage);
    await persistChatLog({
      ...commonLog,
      policy_decision: "allowed",
      status: "error",
      response_status: "error",
      retrieved_chunk_ids: retrievedChunks.map((chunk) => chunk.chunkId),
      retrieved_chunk_metadata: [],
      assistant_response: text,
      response_length: text.length,
      query_type_label: supportMode,
      source_types_used: [],
      visual_assets_used: [],
      incomplete_reason: "missing_api_key",
    });

    return chatJsonResponse(responseFromText(text, requestId, "error", "service_unavailable"), 500);
  }

  const visualInputs = resolveVisualInputs(taskId, query, condition);
  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 45000);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await client.responses.create(
      {
        model,
        instructions: buildSystemInstruction(
          responseLanguage,
          supportMode,
          conversationMemory.workingContext === "user_continuation"
        ),
        max_output_tokens: Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 1200),
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: buildUserInput(
                  query,
                  category,
                  taskPackage,
                  retrievedChunks,
                  supportMode,
                  responseLanguage,
                  conversationMemory
                ),
              },
              ...visualInputs,
            ],
          },
        ],
      },
      { signal: controller.signal }
    );

    clearTimeout(timeout);

    const incompleteReason =
      response.status === "incomplete" ? response.incomplete_details?.reason : undefined;
    const assistantResponse = sanitizeAssistantResponse(response.output_text || "");
    const responseStatus: ChatApiResponse["status"] =
      response.status === "incomplete" || !assistantResponse ? "incomplete" : "success";
    const displayResponse =
      assistantResponse || participantErrorMessage(responseLanguage);

    await persistChatLog({
      ...commonLog,
      participant_id: participantId,
      session_id: sessionId,
      ep_id: epId,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: "allowed",
      status: responseStatus,
      response_status: responseStatus,
      retrieved_chunk_ids: retrievedChunks.map((chunk) => chunk.chunkId),
      retrieved_chunk_metadata: retrievedChunks.map((chunk) => ({
        chunkId: chunk.chunkId,
        sourceId: chunk.sourceId,
        sourceType: chunk.sourceType,
        chunkIndex: chunk.chunkIndex,
        chunkCount: chunk.chunkCount,
        documentChunkIndex: chunk.documentChunkIndex,
        documentChunkCount: chunk.documentChunkCount,
        score: chunk.score,
      })),
      assistant_response: displayResponse,
      timestamp,
      response_length: displayResponse.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: supportMode,
      source_types_used: [...new Set(retrievedChunks.map((chunk) => chunk.sourceType))],
      visual_assets_used: taskPackage.visualAssets
        .slice(0, visualInputs.length)
        .map((asset) => asset.id),
      incomplete_reason: incompleteReason,
    });

    return chatJsonResponse(
      responseFromText(
        displayResponse,
        requestId,
        responseStatus,
        responseStatus === "incomplete" ? incompleteReason || "empty_response" : null
      ),
      responseStatus === "success" ? 200 : 502
    );
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "AbortError";
    const failureResponse = participantErrorMessage(responseLanguage);

    await persistChatLog({
      ...commonLog,
      participant_id: participantId,
      session_id: sessionId,
      ep_id: epId,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: "allowed",
      status: isTimeout ? "timeout" : "error",
      response_status: isTimeout ? "timeout" : "error",
      retrieved_chunk_ids: retrievedChunks.map((chunk) => chunk.chunkId),
      retrieved_chunk_metadata: retrievedChunks.map((chunk) => ({
        chunkId: chunk.chunkId,
        sourceId: chunk.sourceId,
        sourceType: chunk.sourceType,
        chunkIndex: chunk.chunkIndex,
        chunkCount: chunk.chunkCount,
        documentChunkIndex: chunk.documentChunkIndex,
        documentChunkCount: chunk.documentChunkCount,
        score: chunk.score,
      })),
      assistant_response: failureResponse,
      timestamp,
      response_length: failureResponse.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: supportMode,
      source_types_used: [...new Set(retrievedChunks.map((chunk) => chunk.sourceType))],
      visual_assets_used: taskPackage.visualAssets
        .slice(0, visualInputs.length)
        .map((asset) => asset.id),
      incomplete_reason: error instanceof Error ? error.message : String(error),
    });

    return chatJsonResponse(
      responseFromText(failureResponse, requestId, isTimeout ? "timeout" : "error", isTimeout ? "timeout" : "error"),
      500
    );
  }
}
