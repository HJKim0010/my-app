import { NextRequest } from "next/server";
import OpenAI from "openai";
import { classifyQuery, detectRestrictionReason } from "@/backend/policy/classifier";
import { redirectResponse } from "@/backend/policy/redirect";
import { appendChatLog } from "@/backend/logs/logger";
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
import type { ChatLogEntry } from "@/backend/logs/logger";

function sanitizeAssistantResponse(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const CLARIFICATION_REQUEST_PATTERNS = [
  /^what\??$/i,
  /^what do you mean\??$/i,
  /^huh\??$/i,
  /^again\??$/i,
  /^sorry\??$/i,
  /^pardon\??$/i,
  /^what was that\??$/i,
  /^뭐라고\??$/i,
  /^뭐라는 거야\??$/i,
  /^무슨 말이야\??$/i,
  /^무슨 뜻이야\??$/i,
  /^다시\??$/i,
  /^다시 말해줘\??$/i,
  /^다시 설명해줘\??$/i,
  /^쉽게 말해줘\??$/i,
];

type ClarificationOption = "shorter" | "simpler" | "which_part" | null;

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isClarificationRequest(query: string): boolean {
  const normalized = compactText(query);

  if (!normalized || normalized.length > 24) {
    return false;
  }

  return CLARIFICATION_REQUEST_PATTERNS.some((pattern) => pattern.test(normalized));
}

function detectClarificationOption(query: string): ClarificationOption {
  const normalized = compactText(query).toLowerCase();

  if (!normalized || normalized.length > 30) {
    return null;
  }

  if (
    ["1", "1)", "too long", "shorter", "brief", "짧게", "너무 길었어", "길었어"].includes(
      normalized
    )
  ) {
    return "shorter";
  }

  if (
    [
      "2",
      "2)",
      "simpler",
      "easy",
      "easier",
      "쉽게",
      "더 쉽게",
      "어려운 표현",
      "어려웠어",
    ].includes(normalized)
  ) {
    return "simpler";
  }

  if (
    [
      "3",
      "3)",
      "which part",
      "what part",
      "어느 부분",
      "어느 부분인지",
      "부분",
      "뭐를 말하는지",
      "뭐가 뭔지",
    ].includes(normalized)
  ) {
    return "which_part";
  }

  return null;
}

function extractLastAssistantMessage(recentMessages: RecentMessage[]): string {
  for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
    const message = recentMessages[index];
    if (message.role === "assistant") {
      return compactText(message.text);
    }
  }

  return "";
}

function hasClarificationMenu(text: string): boolean {
  const normalized = compactText(text).toLowerCase();
  return (
    normalized.includes("1)") &&
    normalized.includes("2)") &&
    normalized.includes("3)") &&
    (normalized.includes("너무 길었어") ||
      normalized.includes("it was too long") ||
      normalized.includes("어려운 표현") ||
      normalized.includes("difficult expression"))
  );
}

function summarizeAssistantMessage(text: string, language: ResponseLanguage): string {
  const normalized = compactText(
    text
      .replace(/^assistant\s*/i, "")
      .replace(/^[-*]\s*/gm, "")
      .replace(/\s+/g, " ")
  );

  if (!normalized) {
    return language === "korean"
      ? "방금 답을 더 짧고 쉽게 다시 설명할 수 있어요."
      : "I can explain the last answer again in a shorter and simpler way.";
  }

  const firstSentence = normalized.split(/(?<=[.!?])\s+/)[0] || normalized;
  const clipped =
    firstSentence.length > 110 ? `${firstSentence.slice(0, 107).trim()}...` : firstSentence;

  if (language === "korean") {
    return `짧게 다시 말하면, ${clipped}`;
  }

  return `In short, ${clipped}`;
}

function buildClarificationResponse(
  recentMessages: RecentMessage[],
  language: ResponseLanguage
): string {
  const summary = summarizeAssistantMessage(
    extractLastAssistantMessage(recentMessages),
    language
  );

  if (language === "korean") {
    return [
      summary,
      "원하면 이렇게 말해줘도 괜찮아요.",
      "1) 너무 길었어",
      "2) 어려운 표현이 있었어",
      "3) 어느 부분 말인지 모르겠어",
      "번호나 짧은 말로 답하면 그 방식으로 다시 설명할게요.",
    ].join("\n");
  }

  return [
    summary,
    "You can reply like this.",
    "1) It was too long.",
    "2) There was a difficult expression.",
    "3) I am not sure which part you mean.",
    "Reply with a number or a short phrase, and I will explain it that way.",
  ].join("\n");
}

function buildClarificationOptionResponse(
  option: ClarificationOption,
  recentMessages: RecentMessage[],
  language: ResponseLanguage
): string | null {
  if (!option) {
    return null;
  }

  const lastAssistant = extractLastAssistantMessage(recentMessages);
  if (!lastAssistant || !hasClarificationMenu(lastAssistant)) {
    return null;
  }

  const summary = summarizeAssistantMessage(lastAssistant, language);

  if (language === "korean") {
    if (option === "shorter") {
      return [
        summary,
        "핵심만 말하면 이 뜻이에요.",
        "원하면 2) 더 쉽게, 3) 어느 부분인지 집어서 다시 설명할게요.",
      ].join("\n");
    }

    if (option === "simpler") {
      return [
        summary,
        "쉽게 말하면, 방금 답의 핵심 하나만 잡으면 돼요.",
        "헷갈린 단어가 있으면 그 단어만 말해줘도 돼요.",
        "원하면 1) 더 짧게, 3) 어느 부분인지 집어서 다시 설명할게요.",
      ].join("\n");
    }

    return [
      "좋아요. 그럼 헷갈린 부분만 집어서 다시 볼게요.",
      "장면, 인물, 물건, 행동, 문장 중 하나를 짧게 말해줘.",
      "예: table 7 / 쪽지 / Anna가 왜 멈췄는지",
    ].join("\n");
  }

  if (option === "shorter") {
    return [
      summary,
      "That is the main point.",
      "If you want, I can also 2) make it simpler or 3) focus on one specific part.",
    ].join("\n");
  }

  if (option === "simpler") {
    return [
      summary,
      "In easier words, focus on just one main idea from the last answer.",
      "If one word is confusing, you can send just that word.",
      "If you want, I can also 1) make it shorter or 3) focus on one specific part.",
    ].join("\n");
  }

  return [
    "Okay. Then tell me only the part that is confusing.",
    "You can name one scene, person, object, action, or line.",
    "Example: table 7 / the note / why Anna stopped",
  ].join("\n");
}

function buildNoChunkResponse(mode: SupportMode, language: ResponseLanguage): string {
  const korean = language === "korean";

  if (mode === "comprehension") {
    return korean
      ? "지금 질문만으로는 어느 장면이나 부분을 말하는지 확실하지 않아요. 이야기의 한 장면, 인물 행동, 물건, 또는 문장을 하나만 더 말해주면 그 부분을 같이 이해해볼게요."
      : "I am not sure which scene or part you mean yet. If you mention one scene, action, object, or line, I can help you understand that part.";
  }

  if (mode === "ideas") {
    return korean
      ? "지금 질문만으로는 어느 장면을 바탕으로 아이디어를 넓혀야 할지 확실하지 않아요. 특정 장면이나 현재 고민 중인 방향을 한 줄로 말해주면 그 안에서 아이디어를 같이 생각해볼게요."
      : "I am not sure which scene you want to build ideas from yet. If you name the current scene or direction in one line, I can help brainstorm within that part.";
  }

  if (mode === "organization") {
    return korean
      ? "지금 질문만으로는 어떤 부분의 전개를 계획하고 싶은지 확실하지 않아요. beginning, middle, end 중 하나나 지금 쓰고 싶은 장면을 말해주면 구조를 같이 잡아볼게요."
      : "I am not sure which part you want to organize yet. If you name the beginning, middle, end, or the current scene, I can help plan the structure.";
  }

  return korean
    ? "지금 질문만으로는 어떤 단어·표현·문법을 돕고 싶은지 확실하지 않아요. 표현 하나나 문장 하나를 말해주면 그 범위 안에서 도와줄게요."
    : "I am not sure which word, expression, or grammar point you want help with yet. If you share one expression or sentence, I can help within that range.";
}

function persistChatLogInBackground(entry: ChatLogEntry): void {
  void appendChatLog(entry).catch((error) => {
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
          (message: unknown): message is RecentMessage => {
            if (typeof message !== "object" || message === null) {
              return false;
            }

            const candidate = message as Record<string, unknown>;
            return (
              (candidate.role === "user" || candidate.role === "assistant") &&
              typeof candidate.text === "string"
            );
          }
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

  const taskPackage = loadTaskPackage(taskId, condition);
  const timestamp = new Date().toISOString();
  const sessionDurationMs = Math.max(0, Date.now() - sessionStartedAt);
  if (!isValidParticipantId(participantId)) {
    return new Response("Participant ID is required before starting the chat.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const policyDecision = classifyQuery(query);
  const restrictionReason = detectRestrictionReason(query);
  const supportMode = detectSupportMode(query, category);
  const responseLanguage = detectResponseLanguage(query);
  const conversationMemory = buildConversationMemory(taskId, query, recentMessages);
  const clarificationOption = detectClarificationOption(query);

  if (clarificationOption && recentMessages.length > 0) {
    const clarificationOptionResponse = buildClarificationOptionResponse(
      clarificationOption,
      recentMessages,
      responseLanguage
    );

    if (clarificationOptionResponse) {
      persistChatLogInBackground({
        participant_id: participantId,
        session_id: sessionId,
        task_id: taskPackage.config.task_id,
        condition_label: taskPackage.config.ai_condition,
        selected_category: category,
        raw_user_query: query,
        policy_decision: "allowed",
        status: "allowed",
        retrieved_chunk_ids: [],
        retrieved_chunk_metadata: [],
        assistant_response: clarificationOptionResponse,
        timestamp,
        response_length: clarificationOptionResponse.length,
        interaction_count: interactionCount,
        session_duration_ms: sessionDurationMs,
        query_type_label: "clarification_option",
        source_types_used: [],
        visual_assets_used: [],
      });

      return new Response(clarificationOptionResponse, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  }

  if (isClarificationRequest(query) && recentMessages.length > 0) {
    const clarificationResponse = buildClarificationResponse(
      recentMessages,
      responseLanguage
    );

    persistChatLogInBackground({
      participant_id: participantId,
      session_id: sessionId,
      task_id: taskPackage.config.task_id,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: "allowed",
      status: "allowed",
      retrieved_chunk_ids: [],
      retrieved_chunk_metadata: [],
      assistant_response: clarificationResponse,
      timestamp,
      response_length: clarificationResponse.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: "clarification_request",
      source_types_used: [],
      visual_assets_used: [],
    });

    return new Response(clarificationResponse, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (policyDecision === "restricted") {
    const redirected = redirectResponse(restrictionReason ?? "sentence_generation");

    persistChatLogInBackground({
      participant_id: participantId,
      session_id: sessionId,
      task_id: taskPackage.config.task_id,
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
      query_type_label: policyDecision,
      redirect_reason: restrictionReason ?? "sentence_generation",
      source_types_used: [],
      visual_assets_used: [],
    });

    return new Response(redirected, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const retrievedChunks = retrieveTaskChunks(
    taskId,
    query,
    taskPackage,
    4,
    supportMode !== "comprehension",
    conversationMemory
  );

  if (retrievedChunks.length === 0) {
    const boundedResponse = buildNoChunkResponse(supportMode, responseLanguage);

    persistChatLogInBackground({
      participant_id: participantId,
      session_id: sessionId,
      task_id: taskPackage.config.task_id,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: policyDecision,
      status: "allowed",
      retrieved_chunk_ids: [],
      retrieved_chunk_metadata: [],
      assistant_response: boundedResponse,
      timestamp,
      response_length: boundedResponse.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: supportMode,
      source_types_used: [],
      visual_assets_used: [],
    });

    return new Response(boundedResponse, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
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
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 30000);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await client.responses.create(
      {
        model,
        instructions: buildSystemInstruction(responseLanguage),
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
    const assistantResponse = sanitizeAssistantResponse(
      response.output_text || "No response text returned."
    );

    persistChatLogInBackground({
      participant_id: participantId,
      session_id: sessionId,
      task_id: taskPackage.config.task_id,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: policyDecision,
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

    persistChatLogInBackground({
      participant_id: participantId,
      session_id: sessionId,
      task_id: taskPackage.config.task_id,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: policyDecision,
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
