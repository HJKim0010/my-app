import { NextRequest } from "next/server";
import OpenAI from "openai";
import { classifyQuery, detectRestrictionReason } from "@/backend/policy/classifier";
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

function extractLastAssistantMessage(recentMessages: RecentMessage[]): string {
  for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
    if (recentMessages[index]?.role === "assistant") {
      return compactText(recentMessages[index].text);
    }
  }

  return "";
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildAmbiguousReactionResponse(language: ResponseLanguage): string {
  if (language === "english") {
    return "I am not fully sure what you mean yet. If you mean a reaction to my last answer, tell me what felt odd, or choose one: plot, structure, expression, or feedback.";
  }

  return "무슨 뜻인지 아직 정확히 모르겠어요. 방금 제 답변에 대한 반응이라면 어느 부분이 이상했는지 말해주거나, 전개 / 구성 / 표현 / 피드백 중 하나를 골라 주세요.";
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildGreetingResponse(language: ResponseLanguage): string {
  if (language === "english") {
    return "Hello! Are you ready to work on your writing? I can help with ideas, structure, expressions, or understanding a specific part. What would you like help with?";
  }

  return "안녕하세요! writing을 할 준비가 되었나요? 아이디어, 구성, 표현, 또는 특정 부분 이해까지 여러 가지 방법으로 도와드릴 수 있어요. 어떤 걸 도와드릴까요?";
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildAcknowledgmentFollowUp(
  language: ResponseLanguage,
  mode: SupportMode,
  workingContext: "source" | "user_continuation"
): string {
  if (language === "english") {
    if (workingContext === "user_continuation") {
      return "I understand. What would you like to work on next: plot, structure, expression, or feedback?";
    }

    if (mode === "comprehension") {
      return "I understand. What would you like next: one more story detail, the next event, the structure, or an expression?";
    }

    return "I understand. What would you like next: idea development, structure, expression, or feedback?";
  }

  if (workingContext === "user_continuation") {
    return "응으로 이해했어요. 다음은 전개, 구성, 표현, 피드백 중 뭐부터 볼까요?";
  }

  if (mode === "comprehension") {
    return "응으로 이해했어요. 다음은 자료 확인, 전개, 구성, 표현 중 뭐부터 볼까요?";
  }

  return "응으로 이해했어요. 다음은 전개, 구성, 표현, 피드백 중 뭐부터 볼까요?";
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildTargetClarificationResponse(
  language: ResponseLanguage,
  mode: SupportMode
): string {
  if (language === "english") {
    if (mode === "comprehension") {
      return "Please name one scene, action, object, or line first, and I will explain that part.";
    }

    return "Please show me one short part of your idea or draft first, and I will help from there.";
  }

  if (mode === "comprehension") {
    return "먼저 어느 장면, 행동, 물건, 문장을 말하는지 짚어 주세요. 그 부분만 짧게 설명해드릴게요.";
  }

  return "먼저 네가 만든 내용이나 초안의 짧은 부분 하나만 보여 주세요. 그 기준으로 바로 도와드릴게요.";
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildNoChunkResponse(
  mode: SupportMode,
  language: ResponseLanguage,
  workingContext: "source" | "user_continuation"
): string {
  if (language === "english") {
    if (workingContext === "user_continuation") {
      return mode === "feedback"
        ? "I need one short part of your continuation or draft to give feedback. Paste one part, and I will check the flow, language, or logic."
        : "I need one short part of your continuation idea first. Share one scene or a few lines, and I can help with the next event, structure, or expression.";
    }

    return "I need one clearer target first. If you name one scene, clue, action, or line from the story, reading, or video, I can help from that point.";
  }

  if (workingContext === "user_continuation") {
    return mode === "feedback"
      ? "피드백을 하려면 네가 만든 초안이나 전개 일부가 필요해요. 짧은 부분 하나를 보내주면 흐름, 표현, 문법, 논리를 봐드릴게요."
      : "먼저 네가 만든 전개나 아이디어의 짧은 부분 하나가 필요해요. 한 장면이나 몇 줄만 보여주면 다음 전개, 구성, 표현을 도와드릴게요.";
  }

  return "먼저 어느 장면이나 단서를 말하는지 조금만 더 분명하게 알려 주세요. 한 장면, 행동, 물건, 문장 중 하나만 짚어 주면 그 기준으로 도와드릴게요.";
}

function chatJsonResponse(payload: ChatApiResponse, status = 200): Response {
  return Response.json(payload, { status });
}

function confirmationQuickReplies(language: ResponseLanguage): QuickReply[] {
  if (language === "english") {
    return [
      { label: "Yes", value: "Yes. Please help me in that direction.", action: "send" },
      { label: "Different", value: "No. What I mean is ", action: "prefill" },
      { label: "I'll type", action: "focus" },
    ];
  }

  return [
    { label: "맞아요", value: "맞아요. 그 방향으로 도와주세요.", action: "send" },
    { label: "다른 방향", value: "아니에요. 제가 원하는 건 ", action: "prefill" },
    { label: "직접 입력", action: "focus" },
  ];
}

function supportChoiceQuickReplies(language: ResponseLanguage): QuickReply[] {
  if (language === "english") {
    return [
      { label: "Plot", value: "Please help me with the plot.", action: "send" },
      { label: "Structure", value: "Please help me organize the structure.", action: "send" },
      { label: "Expression", value: "Please help me with expressions.", action: "send" },
    ];
  }

  return [
    { label: "전개", value: "다음 전개를 도와주세요.", action: "send" },
    { label: "구성", value: "글의 구성을 도와주세요.", action: "send" },
    { label: "표현", value: "표현을 더 자연스럽게 도와주세요.", action: "send" },
  ];
}

function buildAmbiguousReactionResponseV2(language: ResponseLanguage): ChatApiResponse {
  if (language === "english") {
    return {
      text: "I am not fully sure what you mean yet. Did you mean my last answer was unclear?",
      quickReplies: confirmationQuickReplies(language),
    };
  }

  return {
    text: "아직 뜻을 정확히 잡기 어려워요. 방금 제 답변이 헷갈렸다는 뜻인가요?",
    quickReplies: confirmationQuickReplies(language),
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildGreetingResponseV2(language: ResponseLanguage): ChatApiResponse {
  if (language === "english") {
    return {
      text: "Hello. What would you like help with?",
      quickReplies: supportChoiceQuickReplies(language),
    };
  }

  return {
    text: "안녕하세요! 글쓰기에서 어떤 도움을 받고 싶나요?",
    quickReplies: supportChoiceQuickReplies(language),
  };
}

function buildGreetingClarificationResponse(language: ResponseLanguage): ChatApiResponse {
  if (language === "english") {
    return {
      text: "Hello. Which part would you like help with? You can tap a quick bubble below or type your question directly.",
    };
  }

  return {
    text: "안녕하세요. 어떤 부분을 도와드릴까요? 아래 quick bubble chat을 눌러도 되고, 질문을 직접 입력해도 좋아요.",
  };
}

function buildCalmGreetingResponse(language: ResponseLanguage): ChatApiResponse {
  if (language === "english") {
    return {
      text: "Hello. What would you like help with? You can tap a quick bubble below or type your question directly.",
    };
  }

  return {
    text: "안녕하세요. 어떤 부분을 도와드릴까요? 아래 quick bubble chat을 눌러도 되고, 질문을 직접 입력해도 좋아요.",
  };
}

function buildAcknowledgmentFollowUpV2(language: ResponseLanguage): ChatApiResponse {
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

function buildTargetClarificationResponseV2(
  language: ResponseLanguage,
  mode: SupportMode
): ChatApiResponse {
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
      quickReplies: [
        { label: "장면", value: "이 장면을 설명해주세요: ", action: "prefill" },
        { label: "물건", value: "이 물건을 설명해주세요: ", action: "prefill" },
        { label: "직접 입력", action: "focus" },
      ],
    };
  }

  return {
    text: "아이디어나 초안의 짧은 부분을 먼저 보여주세요. 그 부분부터 같이 다듬어볼게요.",
    quickReplies: confirmationQuickReplies(language),
  };
}

function buildNoChunkResponseV2(
  mode: SupportMode,
  language: ResponseLanguage,
  workingContext: "source" | "user_continuation"
): ChatApiResponse {
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
          ? "피드백을 하려면 이어쓰기나 초안의 짧은 부분이 필요해요."
          : "먼저 이어쓰기 아이디어나 초안의 짧은 부분을 보여주세요.",
      quickReplies: confirmationQuickReplies(language),
    };
  }

  return {
    text: "먼저 어떤 부분을 보고 싶은지 알려주세요. 장면, 단서, 행동, 문장 중 하나를 골라도 좋아요.",
    quickReplies: [
      { label: "장면", value: "이 장면을 설명해주세요: ", action: "prefill" },
      { label: "단서", value: "이 단서를 어떻게 쓰면 좋을까요: ", action: "prefill" },
      { label: "직접 입력", action: "focus" },
    ],
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
    return new Response("Please enter a prompt.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (!isValidParticipantId(participantId)) {
    return new Response("Participant ID is required before starting the chat.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const taskPackage = loadTaskPackage(taskId, condition);
  const epId = toEpId(taskId);
  const timestamp = new Date().toISOString();
  const sessionDurationMs = Math.max(0, Date.now() - sessionStartedAt);
  const policyDecision = classifyQuery(query);
  const restrictionReason = detectRestrictionReason(query);
  const conversationMemory = buildConversationMemory(taskId, query, recentMessages);
  const supportMode = detectSupportMode(query, category, conversationMemory);
  const responseLanguage = detectResponseLanguage(query);

  if (containsGreeting(query) && isVagueHelpRequest(query) && !isGreeting(query)) {
    const response = buildGreetingClarificationResponse(responseLanguage);

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
      assistant_response: response.text,
      timestamp,
      response_length: response.text.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: "greeting_needs_clarification",
      source_types_used: [],
      visual_assets_used: [],
    });

    return chatJsonResponse(response);
  }

  if (isGreeting(query)) {
    const response = buildCalmGreetingResponse(responseLanguage);

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
      assistant_response: response.text,
      timestamp,
      response_length: response.text.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: "greeting",
      source_types_used: [],
      visual_assets_used: [],
    });

    return chatJsonResponse(response);
  }

  if (isAmbiguousShortReaction(query)) {
    const response = buildAmbiguousReactionResponseV2(responseLanguage);

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
      assistant_response: response.text,
      timestamp,
      response_length: response.text.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: "ambiguous_short_reaction",
      source_types_used: [],
      visual_assets_used: [],
    });

    return chatJsonResponse(response);
  }

  if (isShortAcknowledgment(query)) {
    const response = buildAcknowledgmentFollowUpV2(responseLanguage);

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
      assistant_response: response.text,
      timestamp,
      response_length: response.text.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: "acknowledgment",
      source_types_used: [],
      visual_assets_used: [],
    });

    return chatJsonResponse(response);
  }

  if (policyDecision === "restricted") {
    const redirected = redirectResponse(restrictionReason ?? "sentence_generation");
    const redirectPayload: ChatApiResponse = {
      text: redirected,
      quickReplies:
        responseLanguage === "english"
          ? [
              { label: "Outline", value: "Please help me make a short outline.", action: "send" },
              { label: "Ideas", value: "Please suggest possible next events.", action: "send" },
              { label: "One sentence", value: "Please help me revise one sentence: ", action: "prefill" },
            ]
          : [
              { label: "개요", value: "짧은 개요를 만드는 걸 도와주세요.", action: "send" },
              { label: "아이디어", value: "가능한 다음 사건을 제안해주세요.", action: "send" },
              { label: "한 문장", value: "이 한 문장을 고치는 걸 도와주세요: ", action: "prefill" },
            ],
    };

    await persistChatLog({
      participant_id: participantId,
      session_id: sessionId,
      ep_id: epId,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: policyDecision,
      status: "redirected",
      retrieved_chunk_ids: [],
      retrieved_chunk_metadata: [],
      assistant_response: redirected,
      timestamp,
      response_length: redirected.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: "restricted",
      redirect_reason: restrictionReason ?? "sentence_generation",
      source_types_used: [],
      visual_assets_used: [],
    });

    return chatJsonResponse(redirectPayload);
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

    return chatJsonResponse(clarification);
  }

  if (retrievedChunks.length === 0) {
    const boundedResponse = buildNoChunkResponseV2(
      supportMode,
      responseLanguage,
      conversationMemory.workingContext
    );

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
      assistant_response: boundedResponse.text,
      timestamp,
      response_length: boundedResponse.text.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: supportMode,
      source_types_used: [],
      visual_assets_used: [],
    });

    return chatJsonResponse(boundedResponse);
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return new Response("The chatbot is temporarily unavailable. Please try again later.", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const visualInputs = resolveVisualInputs(taskId, query, condition);
  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 60000);

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
    const assistantResponse = sanitizeAssistantResponse(
      response.output_text || extractLastAssistantMessage(recentMessages) || "No response text returned."
    );

    await persistChatLog({
      participant_id: participantId,
      session_id: sessionId,
      ep_id: epId,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: "allowed",
      status: "allowed",
      retrieved_chunk_ids: retrievedChunks.map((chunk) => chunk.chunkId),
      retrieved_chunk_metadata: retrievedChunks.map((chunk) => ({
        chunkId: chunk.chunkId,
        sourceId: chunk.sourceId,
        sourceType: chunk.sourceType,
        chunkIndex: chunk.chunkIndex,
        score: chunk.score,
      })),
      assistant_response: assistantResponse,
      timestamp,
      response_length: assistantResponse.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: supportMode,
      source_types_used: [...new Set(retrievedChunks.map((chunk) => chunk.sourceType))],
      visual_assets_used: taskPackage.visualAssets
        .slice(0, visualInputs.length)
        .map((asset) => asset.id),
      response_status: response.status,
      incomplete_reason: incompleteReason,
    });

    return new Response(assistantResponse, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === "AbortError"
          ? `The OpenAI request timed out after ${Math.round(
              timeoutMs / 1000
            )} seconds. The deployed server may need a longer timeout or a faster model.`
          : error.message
        : "OpenAI request failed.";

    const failureResponse = `OpenAI request failed: ${message}`;

    await persistChatLog({
      participant_id: participantId,
      session_id: sessionId,
      ep_id: epId,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: "allowed",
      status: "allowed",
      retrieved_chunk_ids: retrievedChunks.map((chunk) => chunk.chunkId),
      retrieved_chunk_metadata: retrievedChunks.map((chunk) => ({
        chunkId: chunk.chunkId,
        sourceId: chunk.sourceId,
        sourceType: chunk.sourceType,
        chunkIndex: chunk.chunkIndex,
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
    });

    return new Response(failureResponse, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
