import { NextRequest } from "next/server";
import OpenAI from "openai";
import { classifyQuery, detectRestrictionReason } from "@/backend/policy/classifier";
import { redirectResponse } from "@/backend/policy/redirect";
import { appendChatLog } from "@/backend/logs/logger";
import { resolveVisualInputs } from "@/backend/rag/assetResolver";
import {
  loadTaskPackage,
  type TaskCondition,
  type TaskId,
  type TaskPackage,
} from "@/backend/rag/loader";
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
  "can you explain",
  "explain this",
  "이해가 안 돼",
  "이해 안 돼",
  "잘 모르겠어",
  "모르겠어",
  "무슨 뜻이야",
  "무슨 뜻인지",
  "헷갈려",
  "설명해줘",
  "설명해 줄래",
  "어려워",
  "이 부분이 뭐야",
  "무슨 말이야",
] as const;

const CONFUSION_STOP_MARKERS = [
  "brainstorm",
  "outline",
  "next step",
  "possible ending",
  "useful expression",
  "sentence frame",
  "idea",
  "plan",
  "vocabulary",
  "expression",
  "아이디어",
  "계획",
  "구성",
  "개요",
  "다음 일",
  "다음 사건",
  "다음 아이디어",
  "어휘",
  "단어",
  "표현",
] as const;

const UNDERSTANDING_PATTERNS = [
  "what does",
  "what happened",
  "what problem",
  "why",
  "why is",
  "why was",
  "why did",
  "which part",
  "beginning",
  "middle",
  "end",
  "last part",
  "scene",
  "part",
  "what is happening",
  "what does this part mean",
  "what does the scene show",
  "무슨 뜻",
  "무슨 내용",
  "어떤 내용",
  "무슨 일이",
  "무슨 문제",
  "왜",
  "뭐",
  "뭘",
  "어떤",
  "어떻게",
  "누가",
  "어디",
  "어느 부분",
  "이 부분",
  "설명",
  "이해",
  "장면",
  "놀라",
  "놀랐",
  "놀랬",
  "무서",
  "수상",
  "이상",
  "처음",
  "초반",
  "중간",
  "중반",
  "끝",
  "후반",
  "마지막",
] as const;

const PLANNING_OR_LANGUAGE_PATTERNS = [
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
  "structure",
  "plot",
  "too scary",
  "아이디어",
  "생각",
  "계획",
  "구성",
  "개요",
  "다음 일",
  "다음 사건",
  "다음 아이디어",
  "어휘",
  "단어",
  "표현",
  "브레인스토밍",
  "스토리",
  "전개",
  "플롯",
  "무서울까",
  "너무 무서",
] as const;

const VIDEO_REFERENCE_PATTERNS = [
  "영상",
  "비디오",
  "장면",
  "화면",
  "캡션",
  "video",
  "scene",
  "frame",
] as const;

const STORY_REFERENCE_PATTERNS = [
  "이야기",
  "글",
  "본문",
  "텍스트",
  "지문",
  "story",
  "text",
  "reading",
  "passage",
] as const;

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

function includesAny(text: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

function prefersKorean(text: string): boolean {
  return /[\uac00-\ud7a3]/.test(text);
}

function isConfusionQuery(text: string): boolean {
  return includesAny(text.toLowerCase(), CONFUSION_PATTERNS);
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
  return includesAny(query.toLowerCase(), UNDERSTANDING_PATTERNS);
}

function isShortFollowUpUnderstandingQuery(query: string): boolean {
  const normalized = normalize(query);

  if (normalized.length > 40) {
    return false;
  }

  return [
    "왜",
    "뭐",
    "뭘",
    "어떤",
    "어떻게",
    "누가",
    "어디",
    "놀라",
    "놀랐",
    "놀랬",
    "무서",
    "수상",
    "이상",
    "why",
    "what",
    "which",
    "who",
    "where",
    "how",
  ].some((term) => normalized.includes(term));
}

function isLikelyLocalClarificationQuery(query: string): boolean {
  const normalized = normalize(query);

  if (normalized.length > 60) {
    return false;
  }

  const clueTerms = [
    "왜",
    "뭐",
    "뭘",
    "무엇",
    "어디",
    "어느",
    "보고",
    "봤",
    "보았",
    "보고 놀",
    "놀란",
    "놀랐",
    "놀랬",
    "거지",
    "건지",
    "것 같",
    "what",
    "where",
    "why",
    "saw",
    "see",
    "looked",
    "surprised",
    "shocked",
  ];

  return clueTerms.some((term) => normalized.includes(term));
}

function isPlanningOrLanguageQuery(query: string): boolean {
  return includesAny(query.toLowerCase(), PLANNING_OR_LANGUAGE_PATTERNS);
}

function detectSegmentIntent(query: string): SegmentIntent {
  const normalized = normalize(query);

  const asksAll =
    (normalized.includes("처음") && normalized.includes("중간")) ||
    (normalized.includes("중간") && normalized.includes("끝")) ||
    (normalized.includes("초반") && normalized.includes("중반")) ||
    (normalized.includes("중반") && normalized.includes("후반")) ||
    (normalized.includes("beginning") && normalized.includes("middle")) ||
    (normalized.includes("middle") && normalized.includes("end")) ||
    normalized.includes("처음 중간 끝") ||
    normalized.includes("초반 중반 후반") ||
    normalized.includes("beginning middle end");

  if (asksAll) {
    return "all";
  }

  if (
    ["끝", "후반", "마지막", "last", "final", "ending", "end"].some((term) =>
      normalized.includes(term)
    )
  ) {
    return "end";
  }

  if (["중간", "중반", "middle", "middle part"].some((term) => normalized.includes(term))) {
    return "middle";
  }

  if (
    ["처음", "초반", "beginning", "start", "first part"].some((term) =>
      normalized.includes(term)
    )
  ) {
    return "beginning";
  }

  return null;
}

function detectReferenceMode(text: string): ReferenceMode {
  const normalized = normalize(text);

  if (VIDEO_REFERENCE_PATTERNS.some((term) => normalized.includes(term))) {
    return "video";
  }

  if (STORY_REFERENCE_PATTERNS.some((term) => normalized.includes(term))) {
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
      ["video_transcript", "source_text", "audio_transcript", "scene_labels"].includes(
        document.sourceType
      )
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

function shouldUseContextForUnderstanding(query: string): boolean {
  const normalized = normalize(query);
  const tokens = tokenize(query);

  return normalized.length <= 18 || tokens.length <= 3;
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
      takeBestSentences(taskId, beginning, "beginning start early 처음 초반", 1)[0] ||
      compactSentence(beginning);
    const middleText =
      takeBestSentences(taskId, middle, "middle middle part 중간 중반", 1)[0] ||
      compactSentence(middle);
    const endText =
      takeBestSentences(taskId, end, "end last final ending 끝 후반 마지막", 1)[0] ||
      compactSentence(end);

    return [
      `- ${modeLabel} 처음: ${beginningText}`,
      `- ${modeLabel} 중간: ${middleText}`,
      `- ${modeLabel} 끝: ${endText}`,
      "- 처음, 중간, 끝 중 어느 부분을 더 보고 싶은지 말해줘.",
    ].join("\n");
  }

  const segment =
    intent === "beginning"
      ? segments[0]
      : intent === "middle"
        ? segments[Math.floor((segments.length - 1) / 2)]
        : segments[segments.length - 1];

  const label =
    intent === "beginning"
      ? `${modeLabel} 처음`
      : intent === "middle"
        ? `${modeLabel} 중간`
        : `${modeLabel} 끝`;
  const bestSentences = takeBestSentences(taskId, segment, query, 2);

  if (bestSentences.length === 0) {
    return null;
  }

  return formatClarification(bestSentences, `${label}을 기준으로 보면 이렇게 이해할 수 있어.`);
}

function buildStoryClarification(
  taskId: TaskId,
  query: string,
  contextualQuery: string,
  taskPackage: TaskPackage,
  retrievedChunks: RetrievedChunk[]
): string | null {
  const retrievedNarrative = retrievedChunks
    .map((chunk) => chunk.content.trim())
    .filter(Boolean)
    .join("\n\n");
  const narrative = retrievedNarrative || extractNarrativeText(taskPackage);

  if (!narrative) {
    return null;
  }

  const primaryMatches = takeBestSentences(taskId, narrative, query, 2);
  const contextualMatches =
    contextualQuery && contextualQuery !== query
      ? takeBestSentences(taskId, narrative, contextualQuery, 2)
      : [];
  const bestSentences =
    primaryMatches.length > 0
      ? primaryMatches
      : shouldUseContextForUnderstanding(query)
        ? contextualMatches
        : [];

  if (bestSentences.length === 0) {
    return null;
  }

  return formatClarification(
    bestSentences,
    "원하면 한 부분씩 차근차근 설명해줄게. 어느 장면이나 부분이 헷갈리는지 말해줘."
  );
}

function queryIncludesScaryOption(query: string): boolean {
  const normalized = normalize(query);
  return ["살인", "죽", "kill", "murder", "too scary", "무서울까", "무서워"].some((term) =>
    normalized.includes(term)
  );
}

function buildPlanningResponse(taskId: TaskId, query: string): string {
  const korean = prefersKorean(query);
  const scary = queryIncludesScaryOption(query);

  if (taskId === "task2") {
    if (korean) {
      if (scary) {
        return [
          "- 지금 톤은 갑자기 살인까지 가기보다, 수상한 물건과 비밀 단서 중심의 미스터리로 가는 편이 더 자연스러워 보여.",
          "- 구성은 1) 안나가 테이블 아래 물건을 확인함 2) 그 물건이 쪽지나 남자와 연결된 단서임을 알게 됨 3) 안나가 가져갈지, 신고할지, 뒤따라갈지 결정하는 식으로 짜볼 수 있어.",
          "- 더 긴장감을 주고 싶다면 살인보다는 위험한 경고, 누군가의 추적, 숨겨진 기록 같은 방향이 덜 과하고 더 이어지기 쉬워.",
        ].join("\n");
      }

      return [
        "- 다음 전개는 안나가 테이블 아래 붙어 있던 물건을 확인하는 장면으로 시작하면 자연스러워.",
        "- 가운데 부분에서는 그 물건이 왜 상자, 쪽지, table 7과 연결되는지 단서를 하나씩 밝히면 돼.",
        "- 마지막에는 안나가 바로 행동할지, 누군가를 따라갈지, 아니면 잠시 숨고 생각할지 선택하게 만들면 구성이 잡혀.",
      ].join("\n");
    }

    if (scary) {
      return [
        "- A murder turn may feel too strong for the current tone. The story so far fits a mystery better than sudden extreme violence.",
        "- A workable structure is: 1) Anna checks the hidden object, 2) the object connects to the note or the man, 3) Anna must decide whether to take it, report it, or follow the clue.",
        "- To keep tension high without going too dark, use a warning, a secret record, or someone quietly watching Anna.",
      ].join("\n");
    }

    return [
      "- A natural next step is for Anna to examine the object under table 7.",
      "- In the middle, reveal one clue that links the object to the note, the box, or the man at table 7.",
      "- At the end of the next part, give Anna a clear choice: take it, hide it, report it, or follow the clue.",
    ].join("\n");
  }

  if (korean) {
    return [
      "- 다음 전개는 Jack이 쪽지를 믿을지 말지 결정하는 장면으로 시작하면 좋아.",
      "- 가운데에서는 발표, 시간 압박, 지하철 상황이 한꺼번에 Jack을 더 어렵게 만들도록 갈등을 키울 수 있어.",
      "- 끝에서는 Jack이 선택한 행동 때문에 새로운 문제나 단서를 만나게 하면 다음 문단 구성이 자연스러워져.",
    ].join("\n");
  }

  return [
    "- A clear next step is to focus on Jack's decision about whether to trust the note.",
    "- In the middle, increase pressure by connecting the train situation, time pressure, and the presentation.",
    "- End the next part with a new consequence or clue created by Jack's choice.",
  ].join("\n");
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
  const recentUserMessages = recentMessages
    .filter((message) => message.role === "user")
    .map((message) => message.text.trim())
    .filter(Boolean)
    .slice(-4);

  const contextualQuery = [...recentUserMessages, query.trim()].join(" ").trim();

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

  const retrievedChunks = retrieveTaskChunks(taskId, contextualQuery || query, taskPackage);
  const referenceMode =
    detectReferenceMode(query) || detectReferenceMode(recentUserMessages.join(" "));

  let localResponse: string | null = null;

  if (
    (
      isUnderstandingQuery(query) ||
      isShortFollowUpUnderstandingQuery(query) ||
      isLikelyLocalClarificationQuery(query)
    ) &&
    !isPlanningOrLanguageQuery(query)
  ) {
    localResponse =
      buildSegmentClarification(taskId, contextualQuery || query, taskPackage, referenceMode) ||
      buildStoryClarification(taskId, query, contextualQuery || query, taskPackage, retrievedChunks);
  } else if (isPlanningOrLanguageQuery(query)) {
    localResponse = buildPlanningResponse(taskId, query);
  }

  if (localResponse) {
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
      assistant_response: localResponse,
      timestamp,
      response_length: localResponse.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: policyDecision,
      source_types_used: [...new Set(retrievedChunks.map((chunk) => chunk.sourceType))],
      visual_assets_used: [],
    });

    return new Response(localResponse, {
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
