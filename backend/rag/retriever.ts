import { chunkDocuments, type TaskChunk } from "@/backend/rag/chunker";
import type { ConversationMemory } from "@/backend/rag/conversationMemory";
import {
  detectLexiconSegments,
  expandQueryTerms,
  normalizeLexiconText,
  type StorySegment,
} from "@/backend/rag/lexicon";
import type { TaskCondition, TaskDocument, TaskId, TaskPackage } from "@/backend/rag/loader";

export type RetrievedChunk = TaskChunk & { score: number };

function splitNormalized(text: string): string[] {
  return normalizeLexiconText(text).split(" ").filter(Boolean);
}

function getSegmentForChunk(chunk: TaskChunk, totalChunks: number): StorySegment {
  const count = chunk.documentChunkCount || totalChunks;
  const index = chunk.documentChunkIndex ?? chunk.chunkIndex;

  if (count <= 1) {
    return "beginning";
  }

  if (index <= 0) {
    return "beginning";
  }

  if (index >= count - 1) {
    return "end";
  }

  return "middle";
}

function detectExplicitSegment(query: string): StorySegment | null {
  const normalized = normalizeLexiconText(query);

  if (/(초반|처음|beginning|start)/.test(normalized)) {
    return "beginning";
  }

  if (/(중반|중간|middle)/.test(normalized)) {
    return "middle";
  }

  if (/(후반|끝|마지막|end|last|final)/.test(normalized)) {
    return "end";
  }

  return null;
}

function sourceBoost(sourceType: string): number {
  if (sourceType === "source_text" || sourceType === "video_transcript") {
    return 2;
  }

  if (sourceType === "audio_transcript" || sourceType === "scene_labels") {
    return 1.25;
  }

  if (sourceType === "image_description") {
    return 0.75;
  }

  return 0;
}

function relevanceThreshold(query: string): number {
  return query.trim().length < 20 ? 2 : 3;
}

function scoreChunk(
  taskId: TaskId,
  chunk: TaskChunk,
  query: string,
  totalChunks: number,
  memory?: ConversationMemory
): number {
  const memoryText = [memory?.lastUserFocus || "", ...(memory?.activeEntities || [])].join(" ");
  const expandedTerms = new Set(expandQueryTerms(taskId, `${query} ${memoryText}`));
  const chunkTokens = splitNormalized(chunk.content);
  let score = 0;
  let lexicalScore = 0;

  for (const token of chunkTokens) {
    if (expandedTerms.has(token)) {
      score += 2;
      lexicalScore += 2;
    }
  }

  const normalizedQuery = normalizeLexiconText(query);
  const normalizedChunk = normalizeLexiconText(chunk.content);

  const emphasisPhrases = [
    "under the table",
    "table 7",
    "look under",
    "looked under",
    "taped",
    "taped object",
    "hidden object",
    "heart beat faster",
    "heartbeat",
    "hesitate",
    "hesitation",
    "stop halfway",
    "not sure what to do",
    "테이블 아래",
    "테이블 7",
    "붙어 있는 물건",
    "숨겨진 물건",
    "심장이 빨리",
    "망설",
    "멈칫",
    "놀랐",
    "놀란",
  ];

  for (const phrase of emphasisPhrases) {
    if (normalizedQuery.includes(phrase) && normalizedChunk.includes(phrase)) {
      score += 8;
      lexicalScore += 8;
    }
  }

  const explicitSegment = detectExplicitSegment(query);
  const lexicalSegments = detectLexiconSegments(taskId, `${query} ${memoryText}`);
  const chunkSegment = getSegmentForChunk(chunk, totalChunks);

  if (explicitSegment && explicitSegment === chunkSegment) {
    score += 4;
    lexicalScore += 2;
  }

  if (lexicalSegments.includes(chunkSegment)) {
    score += 2;
  }

  if (memory?.activeScene && memory.activeScene === chunkSegment) {
    score += 3;
  }

  if (memory?.activeEntities?.length) {
    const normalizedChunk = normalizeLexiconText(chunk.content);
    for (const entity of memory.activeEntities) {
      if (normalizedChunk.includes(normalizeLexiconText(entity))) {
        score += 2;
        lexicalScore += 2;
      }
    }
  }

  score += sourceBoost(chunk.sourceType);
  return lexicalScore >= relevanceThreshold(query) ? score : 0;
}

export function retrieveTaskChunks(
  taskId: TaskId,
  query: string,
  taskPackage: TaskPackage,
  limit = 4,
  allowFallback = true,
  memory?: ConversationMemory
): RetrievedChunk[] {
  const chunks = chunkDocuments(taskId, taskPackage.documents);
  const totalChunks = chunks.length;

  const scored = chunks
    .map((chunk) => ({
      ...chunk,
      score: scoreChunk(taskId, chunk, query, totalChunks, memory),
    }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score || a.chunkIndex - b.chunkIndex)
    .slice(0, limit);

  if (scored.length > 0) {
    return scored;
  }

  if (!allowFallback) {
    return [];
  }

  return [];
}

export function retrieveTaskDocumentsForCondition(
  taskId: TaskId,
  query: string,
  documents: TaskDocument[],
  _condition: TaskCondition,
  limit = 4,
  memory?: ConversationMemory
): RetrievedChunk[] {
  const chunks = chunkDocuments(taskId, documents);
  const totalChunks = chunks.length;

  const scored = chunks
    .map((chunk) => ({
      ...chunk,
      score: scoreChunk(taskId, chunk, query, totalChunks, memory),
    }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score || a.chunkIndex - b.chunkIndex)
    .slice(0, limit);

  if (scored.length > 0) {
    return scored;
  }

  return [];
}
