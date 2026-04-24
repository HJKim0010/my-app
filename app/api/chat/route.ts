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

function sanitizeAssistantResponse(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function limitAssistantResponse(text: string): string {
  const normalized = sanitizeAssistantResponse(text);

  if (!normalized) {
    return normalized;
  }

  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > 1) {
    return lines
      .slice(0, 6)
      .map((line) => (line.startsWith("*") || line.startsWith("-") ? line : `* ${line}`))
      .join("\n");
  }

  const sentences = normalized.match(/[^.!?\n]+(?:[.!?]+|$)/g)?.map((part) => part.trim()) ?? [
    normalized,
  ];

  return sentences
    .filter(Boolean)
    .slice(0, 6)
    .map((sentence) => `* ${sentence}`)
    .join("\n");
}

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isShortAcknowledgment(query: string): boolean {
  const normalized = compactText(query);
  return /^(yes|yeah|yep|ok|okay|sure|right|got it|응|ㅇㅇ|네|맞아|그래|좋아|알겠어)$/i.test(
    normalized
  );
}

function isAmbiguousShortReaction(query: string): boolean {
  const normalized = compactText(query);

  if (!normalized || normalized.length > 12) {
    return false;
  }

  return /^(응\?|ㅇㅇ\?|네\?|그래\?|맞아\?|어\?|어\.\.|엥\?|엥|뭐\?|뭐라고\?|what\?|huh\?|hm\?|hmm\?)$/i.test(
    normalized
  );
}

function extractLastAssistantMessage(recentMessages: RecentMessage[]): string {
  for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
    if (recentMessages[index]?.role === "assistant") {
      return compactText(recentMessages[index].text);
    }
  }

  return "";
}

function buildAmbiguousReactionResponse(language: ResponseLanguage): string {
  if (language === "english") {
    return "I am not fully sure what you mean yet. If you mean a reaction to my last answer, tell me what felt odd, or choose one: plot, structure, expression, or feedback.";
  }

  return "무슨 뜻인지 아직 정확히 모르겠어요. 방금 제 답변에 대한 반응이라면 어느 부분이 이상했는지 말해주거나, 전개 / 구성 / 표현 / 피드백 중 하나를 골라 주세요.";
}

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
  const timestamp = new Date().toISOString();
  const sessionDurationMs = Math.max(0, Date.now() - sessionStartedAt);
  const policyDecision = classifyQuery(query);
  const restrictionReason = detectRestrictionReason(query);
  const conversationMemory = buildConversationMemory(taskId, query, recentMessages);
  const supportMode = detectSupportMode(query, category, conversationMemory);
  const responseLanguage = detectResponseLanguage(query);

  if (isAmbiguousShortReaction(query)) {
    const response = buildAmbiguousReactionResponse(responseLanguage);

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
      assistant_response: response,
      timestamp,
      response_length: response.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: "ambiguous_short_reaction",
      source_types_used: [],
      visual_assets_used: [],
    });

    return new Response(response, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (isShortAcknowledgment(query)) {
    const response = buildAcknowledgmentFollowUp(
      responseLanguage,
      supportMode,
      conversationMemory.workingContext
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
      assistant_response: response,
      timestamp,
      response_length: response.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: "acknowledgment",
      source_types_used: [],
      visual_assets_used: [],
    });

    return new Response(response, {
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
      query_type_label: "restricted",
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
    const clarification = buildTargetClarificationResponse(responseLanguage, supportMode);

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
      assistant_response: clarification,
      timestamp,
      response_length: clarification.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: "needs_target_clarification",
      source_types_used: [],
      visual_assets_used: [],
    });

    return new Response(clarification, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (retrievedChunks.length === 0) {
    const boundedResponse = buildNoChunkResponse(
      supportMode,
      responseLanguage,
      conversationMemory.workingContext
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
        instructions: buildSystemInstruction(
          responseLanguage,
          supportMode,
          conversationMemory.workingContext === "user_continuation"
        ),
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
    const assistantResponse = limitAssistantResponse(
      response.output_text || extractLastAssistantMessage(recentMessages) || "No response text returned."
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
