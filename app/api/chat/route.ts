import { NextRequest } from "next/server";
import OpenAI from "openai";
import { classifyQuery, detectRestrictionReason } from "@/backend/policy/classifier";
import { redirectResponse } from "@/backend/policy/redirect";
import { appendChatLog } from "@/backend/logs/logger";
import { resolveVisualInputs } from "@/backend/rag/assetResolver";
import { loadTaskPackage, type TaskCondition, type TaskId, type TaskPackage } from "@/backend/rag/loader";
import { expandQueryTerms } from "@/backend/rag/lexicon";
import { buildSystemInstruction, buildUserInput } from "@/backend/rag/promptBuilder";
import { retrieveTaskChunks, type RetrievedChunk } from "@/backend/rag/retriever";

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
  "아이디어",
  "글짜기",
  "구성",
  "문단 계획",
  "다음 단계",
  "brainstorm",
  "outline",
  "next step",
  "possible ending",
  "useful expression",
  "sentence frame",
];

type ReferenceMode = "video" | "story" | null;
type SegmentIntent = "all" | "beginning" | "middle" | "end" | null;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/([a-z])([\uac00-\ud7a3])/g, "$1 $2")
    .replace(/([\uac00-\ud7a3])([a-z])/g, "$1 $2")
    .replace(/([0-9])([\uac00-\ud7a3a-z])/g, "$1 $2")
    .replace(/([\uac00-\ud7a3a-z])([0-9])/g, "$1 $2")
    .replace(/[^a-z0-9\uac00-\ud7a3\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return normalize(text)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

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

function isPlaceholderText(text: string): boolean {
  const normalized = text.trim();
  return !normalized || normalized.startsWith("[TODO]");
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
    "뭐야",
    "맞아",
    "맞지",
    "어떤 거",
    "어떻게",
    "무슨 일이",
  ].some((term) => normalized.includes(term));
}

function isPlanningOrLanguageQuery(query: string): boolean {
  const normalized = query.toLowerCase();
  return [
    "idea",
    "ideas",
    "plan",
    "outline",
    "next event",
    "next idea",
    "organization",
    "organize",
    "vocabulary",
    "expression",
    "word",
    "words",
    "brainstorm",
    "possible ending",
    "아이디어",
    "개요",
    "구성",
    "계획",
    "표현",
    "어휘",
    "단어",
    "다음 사건",
    "다음 전개",
  ].some((term) => normalized.includes(term));
}

function detectSegmentIntent(query: string): SegmentIntent {
  const normalized = normalize(query);

  const asksAll =
    (normalized.includes("초반") && normalized.includes("중반")) ||
    (normalized.includes("중반") && normalized.includes("후반")) ||
    (normalized.includes("beginning") && normalized.includes("middle")) ||
    (normalized.includes("middle") && normalized.includes("end")) ||
    normalized.includes("초반 중반 후반") ||
    normalized.includes("beginning middle end");

  if (asksAll) {
    return "all";
  }

  if (["마지막", "끝", "후반", "last", "final", "ending", "end"].some((term) => normalized.includes(term))) {
    return "end";
  }

  if (["중반", "middle", "middle part"].some((term) => normalized.includes(term))) {
    return "middle";
  }

  if (["초반", "처음", "beginning", "start", "first part"].some((term) => normalized.includes(term))) {
    return "beginning";
  }

  return null;
}

function detectReferenceMode(text: string): ReferenceMode {
  const normalized = normalize(text);

  if (["영상", "비디오", "장면", "캡션", "동영상", "video", "scene", "frame"].some((term) => normalized.includes(term))) {
    return "video";
  }

  if (["스토리", "이야기", "글", "텍스트", "본문", "story", "text", "reading"].some((term) => normalized.includes(term))) {
    return "story";
  }

  return null;
}

function buildExpandedTokenSet(taskId: TaskId, text: string): Set<string> {
  return new Set(expandQueryTerms(taskId, text));
}

function scoreSentence(taskId: TaskId, sentence: string, query: string): number {
  const queryTokens = buildExpandedTokenSet(taskId, query);
  const sentenceTokens = tokenize(sentence);
  let score = 0;

  for (const token of sentenceTokens) {
    if (queryTokens.has(token)) {
      score += 1;
    }
  }

  return score;
}

function extractNarrativeText(taskPackage: TaskPackage): string {
  const relevant = taskPackage.documents
    .filter((document) =>
      ["video_transcript", "source_text", "audio_transcript", "scene_labels"].includes(document.sourceType)
    )
    .map((document) => document.content.trim())
    .filter((content) => !isPlaceholderText(content));

  const deduped = [...new Set(relevant)];
  return deduped.join("\n\n").trim();
}

function splitNarrativeIntoSegments(text: string): string[] {
  const normalized = text.replace(/\r/g, "").trim();

  if (!normalized) {
    return [];
  }

  const blocks = normalized
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length >= 3) {
    return blocks;
  }

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length <= 3) {
    return sentences;
  }

  const chunkSize = Math.ceil(sentences.length / 3);
  const grouped: string[] = [];

  for (let index = 0; index < sentences.length; index += chunkSize) {
    grouped.push(sentences.slice(index, index + chunkSize).join(" ").trim());
  }

  return grouped.filter(Boolean);
}

function compactSentence(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
}

function takeBestSentences(taskId: TaskId, text: string, query: string, limit = 2): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => compactSentence(sentence))
    .filter(Boolean);

  return sentences
    .map((sentence) => ({
      sentence,
      score: scoreSentence(taskId, sentence, query),
    }))
    .sort((a, b) => b.score - a.score || a.sentence.length - b.sentence.length)
    .filter((item) => item.score > 0)
    .slice(0, limit)
    .map((item) => item.sentence);
}

function formatClarification(sentences: string[], tail?: string): string {
  const bulletLines = sentences.slice(0, 2).map((sentence) => `- ${sentence}`);

  if (tail) {
    bulletLines.push(`- ${tail}`);
  }

  return bulletLines.join("\n");
}

function buildReferenceModeQuestion(query: string): string {
  const segmentIntent = detectSegmentIntent(query);

  if (segmentIntent === "all") {
    return "초반·중반·후반을 설명해줄게. 영상 기준으로 볼까, 이야기 흐름 기준으로 볼까?";
  }

  return "이 부분은 영상 기준으로 설명해줄까, 이야기 흐름 기준으로 설명해줄까?";
}

function buildSegmentClarification(
  taskId: TaskId,
  query: string,
  taskPackage: TaskPackage,
  referenceMode: ReferenceMode
): string | null {
  const intent = detectSegmentIntent(query);

  if (!intent) {
    return null;
  }

  const narrative = extractNarrativeText(taskPackage);
  const segments = splitNarrativeIntoSegments(narrative);

  if (segments.length === 0) {
    return null;
  }

  const modeLabel = referenceMode === "video" ? "영상" : "이야기";

  if (intent === "all") {
    const beginning = segments[0];
    const middle = segments[Math.floor((segments.length - 1) / 2)];
    const end = segments[segments.length - 1];

    const beginningText =
      takeBestSentences(taskId, beginning, "beginning start early 초반 처음", 1)[0] || compactSentence(beginning);
    const middleText =
      takeBestSentences(taskId, middle, "middle middle part 중반", 1)[0] || compactSentence(middle);
    const endText =
      takeBestSentences(taskId, end, "end last final ending 후반 마지막", 1)[0] || compactSentence(end);

    return [
      `- ${modeLabel} 초반: ${beginningText}`,
      `- ${modeLabel} 중반: ${middleText}`,
      `- ${modeLabel} 후반: ${endText}`,
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
    intent === "beginning" ? `${modeLabel} 초반` : intent === "middle" ? `${modeLabel} 중반` : `${modeLabel} 후반`;
  const bestSentences = takeBestSentences(taskId, segment, query, 2);

  if (bestSentences.length === 0) {
    return null;
  }

  return formatClarification(bestSentences, `${label}은 이렇게 보면 돼.`);
}

function buildStoryClarification(
  taskId: TaskId,
  query: string,
  contextualQuery: string,
  taskPackage: TaskPackage
): string | null {
  const narrative = extractNarrativeText(taskPackage);

  if (!narrative) {
    return null;
  }

  const bestSentences =
    takeBestSentences(taskId, narrative, contextualQuery, 2).length > 0
      ? takeBestSentences(taskId, narrative, contextualQuery, 2)
      : takeBestSentences(taskId, narrative, query, 2);

  if (bestSentences.length === 0) {
    return null;
  }

  return formatClarification(
    bestSentences,
    "이 부분 기준으로 먼저 이해하면 돼. 더 보고 싶은 장면이나 부분을 한 번 더 말해줘."
  );
}

function shouldAskReferenceMode(
  query: string,
  recentMessages: Array<{ role: "user" | "assistant"; text: string }>
): boolean {
  const segmentIntent = detectSegmentIntent(query);

  if (!segmentIntent) {
    return false;
  }

  const currentMode = detectReferenceMode(query);
  if (currentMode) {
    return false;
  }

  const recentMode = detectReferenceMode(recentMessages.slice(-4).map((message) => message.text).join(" "));
  return recentMode === null;
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
  let recentMessages: Array<{ role: "user" | "assistant"; text: string }> = [];

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
    recentMessages = Array.isArray(body?.recentMessages)
      ? (body.recentMessages as unknown[])
          .filter(
            (
              message: unknown
            ): message is { role: "user" | "assistant"; text: string } =>
              typeof message === "object" &&
              message !== null &&
              "role" in message &&
              "text" in message &&
              ((message as { role?: unknown }).role === "user" ||
                (message as { role?: unknown }).role === "assistant") &&
              typeof (message as { text?: unknown }).text === "string"
          )
          .slice(-4)
      : [];
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
  const contextualQuery = [...recentMessages.map((message) => message.text.trim()).filter(Boolean), query.trim()]
    .join(" ")
    .trim();

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

  const retrievedChunks = retrieveTaskChunks(taskId, contextualQuery || query, condition);
  const referenceMode =
    detectReferenceMode(query) ||
    detectReferenceMode(recentMessages.slice(-4).map((message) => message.text).join(" "));

  let localUnderstandingResponse: string | null = null;

  if (isUnderstandingQuery(query) && !isPlanningOrLanguageQuery(query)) {
    if (shouldAskReferenceMode(query, recentMessages)) {
      localUnderstandingResponse = buildReferenceModeQuestion(query);
    } else {
      localUnderstandingResponse =
        buildSegmentClarification(taskId, contextualQuery || query, taskPackage, referenceMode) ||
        buildStoryClarification(taskId, query, contextualQuery || query, taskPackage);
    }
  }

  if (localUnderstandingResponse) {
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
      assistant_response: localUnderstandingResponse,
      timestamp,
      response_length: localUnderstandingResponse.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: policyDecision,
      source_types_used: [...new Set(retrievedChunks.map((chunk) => chunk.sourceType))],
      visual_assets_used: [],
    });

    return new Response(localUnderstandingResponse, {
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
      visual_assets_used: taskPackage.visualAssets.slice(0, visualInputs.length).map((asset) => asset.id),
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
      visual_assets_used: taskPackage.visualAssets.slice(0, visualInputs.length).map((asset) => asset.id),
    });

    return new Response(failureResponse, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
