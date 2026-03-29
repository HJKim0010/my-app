import { chunkDocuments, type TaskChunk } from "@/backend/rag/chunker";
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
  if (totalChunks <= 1) {
    return "beginning";
  }

  if (chunk.chunkIndex <= 0) {
    return "beginning";
  }

  if (chunk.chunkIndex >= totalChunks - 1) {
    return "end";
  }

  return "middle";
}

function detectExplicitSegment(query: string): StorySegment | null {
  const normalized = normalizeLexiconText(query);

  if (/(초반|처음|beginning|start)/.test(normalized)) {
    return "beginning";
  }

  if (/(중반|middle)/.test(normalized)) {
    return "middle";
  }

  if (/(후반|마지막|끝|end|last|final)/.test(normalized)) {
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

function scoreChunk(taskId: TaskId, chunk: TaskChunk, query: string, totalChunks: number): number {
  const expandedTerms = new Set(expandQueryTerms(taskId, query));
  const chunkTokens = splitNormalized(chunk.content);
  let score = 0;

  for (const token of chunkTokens) {
    if (expandedTerms.has(token)) {
      score += 2;
    }
  }

  const explicitSegment = detectExplicitSegment(query);
  const lexicalSegments = detectLexiconSegments(taskId, query);
  const chunkSegment = getSegmentForChunk(chunk, totalChunks);

  if (explicitSegment && explicitSegment === chunkSegment) {
    score += 4;
  }

  if (lexicalSegments.includes(chunkSegment)) {
    score += 2;
  }

  score += sourceBoost(chunk.sourceType);
  return score;
}

function fallbackChunks(chunks: TaskChunk[], query: string): TaskChunk[] {
  const explicitSegment = detectExplicitSegment(query);

  if (explicitSegment === "beginning") {
    return chunks.slice(0, Math.min(2, chunks.length));
  }

  if (explicitSegment === "middle") {
    const start = Math.max(0, Math.floor(chunks.length / 2) - 1);
    return chunks.slice(start, Math.min(start + 2, chunks.length));
  }

  if (explicitSegment === "end") {
    return chunks.slice(Math.max(0, chunks.length - 2));
  }

  return chunks.slice(0, Math.min(3, chunks.length));
}

export function retrieveTaskChunks(
  taskId: TaskId,
  query: string,
  taskPackage: TaskPackage,
  limit = 4
): RetrievedChunk[] {
  const chunks = chunkDocuments(taskId, taskPackage.documents);
  const totalChunks = chunks.length;

  const scored = chunks
    .map((chunk) => ({
      ...chunk,
      score: scoreChunk(taskId, chunk, query, totalChunks),
    }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score || a.chunkIndex - b.chunkIndex)
    .slice(0, limit);

  if (scored.length > 0) {
    return scored;
  }

  return fallbackChunks(chunks, query).map((chunk) => ({
    ...chunk,
    score: taskPackage.condition === "dynamic" ? 0.5 : 0.4,
  }));
}

export function retrieveTaskDocumentsForCondition(
  taskId: TaskId,
  query: string,
  documents: TaskDocument[],
  condition: TaskCondition,
  limit = 4
): RetrievedChunk[] {
  const chunks = chunkDocuments(taskId, documents);
  const totalChunks = chunks.length;

  const scored = chunks
    .map((chunk) => ({
      ...chunk,
      score: scoreChunk(taskId, chunk, query, totalChunks),
    }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score || a.chunkIndex - b.chunkIndex)
    .slice(0, limit);

  if (scored.length > 0) {
    return scored;
  }

  return fallbackChunks(chunks, query).map((chunk) => ({
    ...chunk,
    score: condition === "dynamic" ? 0.5 : 0.4,
  }));
}
