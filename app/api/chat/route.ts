import { NextRequest } from "next/server";
import OpenAI from "openai";
import { classifyQuery, detectRestrictionReason } from "@/backend/policy/classifier";
import { redirectResponse } from "@/backend/policy/redirect";
import { appendChatLog } from "@/backend/logs/logger";
import { resolveVisualInputs } from "@/backend/rag/assetResolver";
import { loadTaskPackage, type TaskCondition, type TaskId } from "@/backend/rag/loader";
import { buildSystemInstruction, buildUserInput } from "@/backend/rag/promptBuilder";
import { retrieveTaskChunks } from "@/backend/rag/retriever";
import type { TaskPackage } from "@/backend/rag/loader";
import type { RetrievedChunk } from "@/backend/rag/retriever";

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

function tokenizeForLocal(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/([a-z])([\uac00-\ud7a3])/g, "$1 $2")
    .replace(/([\uac00-\ud7a3])([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9\uac00-\ud7a3\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function isUnderstandingQuery(query: string): boolean {
  const normalized = query.toLowerCase();
  return [
    "what does",
    "what happened",
    "what problem",
    "which part",
    "beginning",
    "middle",
    "end",
    "last part",
    "scene",
    "part",
    "의미",
    "무슨 뜻",
    "설명",
    "무슨 내용",
    "어떤 내용",
    "문제",
    "초반",
    "중반",
    "후반",
    "마지막",
    "장면",
    "부분",
    "이해",
    "모르겠",
    "헷갈",
    "기억이 안",
  ].some((term) => normalized.includes(term));
}

function detectSegmentIntent(query: string): "all" | "beginning" | "middle" | "end" | null {
  const normalized = query.toLowerCase();
  const asksAll =
    (normalized.includes("초반") && normalized.includes("중반")) ||
    (normalized.includes("middle") && normalized.includes("beginning")) ||
    (normalized.includes("초반") && normalized.includes("후반")) ||
    (normalized.includes("beginning") && normalized.includes("end")) ||
    normalized.includes("초반 중반 후반") ||
    normalized.includes("beginning middle end");

  if (asksAll) {
    return "all";
  }

  if (
    ["마지막", "후반", "끝", "last", "final", "ending", "end"].some((term) =>
      normalized.includes(term)
    )
  ) {
    return "end";
  }

  if (
    ["중반", "middle", "middle part"].some((term) => normalized.includes(term))
  ) {
    return "middle";
  }

  if (
    ["초반", "처음", "beginning", "start", "first part"].some((term) =>
      normalized.includes(term)
    )
  ) {
    return "beginning";
  }

  return null;
}

function extractNarrativeText(taskPackage: TaskPackage): string {
  const preferred = taskPackage.documents.find((document) =>
    ["video_transcript", "source_text", "audio_transcript", "scene_labels"].includes(
      document.sourceType
    )
  );

  return preferred?.content ?? "";
}

function splitNarrativeIntoSegments(text: string): string[] {
  const normalized = text.replace(/\r/g, "").trim();

  if (!normalized) {
    return [];
  }

  const paragraphSegments = normalized
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (paragraphSegments.length >= 3) {
    return paragraphSegments;
  }

  const sentenceSegments = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentenceSegments.length <= 3) {
    return sentenceSegments;
  }

  const chunkSize = Math.ceil(sentenceSegments.length / 3);
  const grouped: string[] = [];

  for (let index = 0; index < sentenceSegments.length; index += chunkSize) {
    grouped.push(sentenceSegments.slice(index, index + chunkSize).join(" ").trim());
  }

  return grouped.filter(Boolean);
}

function compactSentence(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}

function takeBestSentences(text: string, query: string, limit = 2): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => compactSentence(sentence))
    .filter(Boolean);
  const queryTokens = new Set(tokenizeForLocal(query));

  return sentences
    .map((sentence) => ({
      sentence,
      score: tokenizeForLocal(sentence).reduce(
        (sum, token) => sum + (queryTokens.has(token) ? 1 : 0),
        0
      ),
    }))
    .sort((a, b) => b.score - a.score || a.sentence.length - b.sentence.length)
    .slice(0, limit)
    .map((item) => item.sentence);
}

function formatLocalClarification(sentences: string[], tail?: string): string {
  const bulletLines = sentences.slice(0, 2).map((sentence) => `- ${sentence}`);
  if (tail) {
    bulletLines.push(`- ${tail}`);
  }
  return bulletLines.join("\n");
}

function buildSegmentClarification(query: string, taskPackage: TaskPackage): string | null {
  const intent = detectSegmentIntent(query);

  if (!intent) {
    return null;
  }

  const narrative = extractNarrativeText(taskPackage);
  const segments = splitNarrativeIntoSegments(narrative);

  if (segments.length === 0) {
    return null;
  }

  if (intent === "all") {
    const beginning = segments[0];
    const middle = segments[Math.floor((segments.length - 1) / 2)];
    const end = segments[segments.length - 1];

    return [
      `- 초반: ${takeBestSentences(beginning, "beginning start 초반 처음", 1).join(" ")}`,
      `- 중반: ${takeBestSentences(middle, "middle 중반", 1).join(" ")}`,
      `- 후반: ${takeBestSentences(end, "end last final 후반 마지막", 1).join(" ")}`,
      "- 어느 부분을 먼저 더 자세히 볼까?",
    ].join("\n");
  }

  const segment =
    intent === "beginning"
      ? segments[0]
      : intent === "middle"
        ? segments[Math.floor((segments.length - 1) / 2)]
        : segments[segments.length - 1];

  const label =
    intent === "beginning" ? "초반" : intent === "middle" ? "중반" : "후반";

  const simpleWords =
    intent === "beginning"
      ? "key words: start, prepare, late"
      : intent === "middle"
        ? "key words: rush, train, forgot"
        : "key words: note, warning, decision";

  return formatLocalClarification(takeBestSentences(segment, query, 2), `${label}은 이렇게 보면 돼. ${simpleWords}`);
}

function buildRetrievedClarification(query: string, retrievedChunks: RetrievedChunk[]): string | null {
  if (!retrievedChunks.length) {
    return null;
  }

  const combined = retrievedChunks
    .slice(0, 2)
    .map((chunk) => chunk.content)
    .join(" ");

  const bestSentences = takeBestSentences(combined, query, 2);

  if (bestSentences.length === 0) {
    return null;
  }

  return formatLocalClarification(bestSentences, "이 부분을 먼저 이해하고, 헷갈리는 한 장면만 다시 물어보면 더 자세히 설명할게.");
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

  const retrievedChunks = retrieveTaskChunks(taskId, query, condition);

  const directClarification =
    buildSegmentClarification(query, taskPackage) ||
    (isUnderstandingQuery(query) ? buildRetrievedClarification(query, retrievedChunks) : null);

  if (directClarification) {
    await appendChatLog({
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
      assistant_response: directClarification,
      timestamp,
      response_length: directClarification.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: policyDecision,
      source_types_used: [...new Set(retrievedChunks.map((chunk) => chunk.sourceType))],
      visual_assets_used: [],
    });

    return new Response(directClarification, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (retrievedChunks.length === 0) {
    const boundedResponse =
      "I could not find a closely relevant part of the current task materials for that question. Please ask about one specific scene, part, event, or word from the assigned story.";

    await appendChatLog({
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
