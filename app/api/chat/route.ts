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
  detectSupportMode,
  prefersKorean,
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

function buildNoChunkResponse(mode: SupportMode, korean: boolean): string {
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

export async function POST(request: NextRequest) {
  let query = "";
  let category = "Others";
  let taskId: TaskId = "task1";
  let condition: TaskCondition = "static";
  let participantId = "anonymous";
  let sessionId = "unknown-session";
  let interactionCount = 1;
  let sessionStartedAt = Date.now();
  let recentMessages: RecentMessage[] = [];

  try {
    const body = await request.json();
    query = typeof body?.query === "string" ? body.query : "";
    category = typeof body?.category === "string" ? body.category : category;
    taskId = body?.taskId === "task2" ? "task2" : "task1";
    condition = body?.condition === "dynamic" ? "dynamic" : "static";
    participantId =
      typeof body?.participantId === "string" && body.participantId.trim()
        ? body.participantId.trim()
        : participantId;
    sessionId = typeof body?.sessionId === "string" ? body.sessionId : sessionId;
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
  const policyDecision = classifyQuery(query);
  const restrictionReason = detectRestrictionReason(query);
  const supportMode = detectSupportMode(query, category);
  const korean = prefersKorean(query);
  const conversationMemory = buildConversationMemory(taskId, query, recentMessages);

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
    const boundedResponse = buildNoChunkResponse(supportMode, korean);

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
        instructions: buildSystemInstruction(),
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
