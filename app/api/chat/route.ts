import { NextRequest } from "next/server";
import OpenAI from "openai";
import { classifyQuery, detectRestrictionReason } from "@/backend/policy/classifier";
import { redirectResponse } from "@/backend/policy/redirect";
import { appendChatLog } from "@/backend/logs/logger";
import { resolveVisualInputs } from "@/backend/rag/assetResolver";
import { loadTaskPackage, type TaskCondition, type TaskId } from "@/backend/rag/loader";
import { buildSystemInstruction, buildUserInput } from "@/backend/rag/promptBuilder";
import { retrieveTaskChunks } from "@/backend/rag/retriever";

const CONFUSION_PATTERNS = [
  "i don't understand",
  "i do not understand",
  "i am confused",
  "i'm confused",
  "this is hard",
  "i'm lost",
  "i am lost",
  "i don't get it",
  "i do not get it",
  "what does this mean",
  "무슨 뜻",
  "이해가 안",
  "헷갈",
  "어려워",
  "기억이 안",
  "잘 모르겠",
  "아무것도 모르겠",
];

const CONFUSION_STOP_MARKERS = [
  "이어서 쓸",
  "글을 짤",
  "구성 틀",
  "문장 틀",
  "원하면 다음 단계",
  "brainstorm",
  "outline",
  "개요",
  "유용한 표현",
  "문단 계획",
  "다음에 생각할 수 있는 방향",
  "쓸 때 유지해야 할",
  "영어 표현만",
  "줄거리 아이디어",
  "도입-중간-끝",
];

function isConfusionQuery(text: string): boolean {
  const normalized = text.toLowerCase();
  return CONFUSION_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function sanitizeAssistantResponse(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toSentenceFragments(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function trimConfusionResponse(text: string): string {
  const sanitized = sanitizeAssistantResponse(text);
  const lines = sanitized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const keptLines: string[] = [];

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (CONFUSION_STOP_MARKERS.some((marker) => lower.includes(marker.toLowerCase()))) {
      break;
    }

    keptLines.push(line.replace(/^[-*]\s*/, "- "));
    if (keptLines.length >= 3) {
      break;
    }
  }

  const compact = keptLines.join("\n").trim();
  if (compact) {
    return compact;
  }

  return toSentenceFragments(sanitized)
    .slice(0, 2)
    .join(" ")
    .trim();
}

export async function POST(request: NextRequest) {
  let query = "";
  let category = "Others";
  let taskId: TaskId = "task1";
  let condition: TaskCondition = "static";
  let sessionId = "unknown-session";
  let interactionCount = 1;
  let sessionStartedAt = Date.now();

  try {
    const body = await request.json();
    query = typeof body?.query === "string" ? body.query : "";
    category = typeof body?.category === "string" ? body.category : category;
    taskId = body?.taskId === "task2" ? "task2" : "task1";
    condition = body?.condition === "dynamic" ? "dynamic" : "static";
    sessionId = typeof body?.sessionId === "string" ? body.sessionId : sessionId;
    interactionCount =
      typeof body?.interactionCount === "number" ? body.interactionCount : interactionCount;
    sessionStartedAt =
      typeof body?.sessionStartedAt === "number" ? body.sessionStartedAt : sessionStartedAt;
  } catch {
    query = "";
  }

  const taskPackage = loadTaskPackage(taskId, condition);
  const timestamp = new Date().toISOString();
  const sessionDurationMs = Math.max(0, Date.now() - sessionStartedAt);

  if (!query.trim()) {
    return new Response("Please enter a prompt.", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const policyDecision = classifyQuery(query);
  const restrictionReason = detectRestrictionReason(query);

  if (policyDecision === "restricted") {
    const redirected = redirectResponse(restrictionReason ?? "sentence_generation");

    await appendChatLog({
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

  const retrievedChunks = retrieveTaskChunks(taskId, query, condition);

  if (retrievedChunks.length === 0) {
    const boundedResponse =
      "I could not find a closely relevant part of the current Task1 session materials for that question. Please ask about a specific scene, line, segment, idea, organization choice, or word from the assigned source.";

    await appendChatLog({
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
      query_type_label: policyDecision,
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
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
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
                text: buildUserInput(query, category, taskPackage, retrievedChunks),
              },
              ...visualInputs,
            ],
          },
        ],
      },
      {
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);
    const rawAssistantResponse = response.output_text || "No response text returned.";
    const assistantResponse = isConfusionQuery(query)
      ? trimConfusionResponse(rawAssistantResponse)
      : sanitizeAssistantResponse(rawAssistantResponse);

    await appendChatLog({
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
      query_type_label: policyDecision,
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

    await appendChatLog({
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
      query_type_label: policyDecision,
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
