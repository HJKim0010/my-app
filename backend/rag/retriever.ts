import { chunkDocuments, type TaskChunk } from "@/backend/rag/chunker";
import { loadTaskPackage, type TaskCondition, type TaskId } from "@/backend/rag/loader";
import { detectLexiconSegments, expandQueryTerms } from "@/backend/rag/lexicon";

export type RetrievedChunk = TaskChunk & {
  score: number;
};

const GENERIC_QUERY_EXPANSIONS: Record<string, string[]> = {
  busy: ["prepare", "presentation", "project", "team", "lead", "practice"],
  late: ["alarm", "clock", "sunlight", "late", "rush", "지각", "늦다"],
  worried: ["tense", "nervous", "warning", "decision", "불안", "긴장"],
  problem: ["conflict", "warning", "decision", "issue", "문제", "갈등"],
  ending: ["last", "final", "decision", "warning", "station", "결말", "마지막"],
  last: ["ending", "final", "decision", "warning", "station", "마지막", "후반"],
  final: ["ending", "last", "decision", "station", "graduation", "최종", "마지막"],
  story: ["scene", "part", "moment", "event", "이야기", "스토리", "내용"],
  video: ["scene", "moment", "frame", "part", "영상", "장면"],
  scene: ["video", "moment", "frame", "scene", "장면"],
  마지막: ["끝", "후반", "last", "final", "ending"],
  끝: ["마지막", "후반", "last", "final", "ending"],
  후반: ["마지막", "끝", "later", "final", "ending"],
  초반: ["처음", "beginning", "start", "early"],
  중반: ["middle", "middle part", "midpoint"],
  처음: ["초반", "beginning", "start", "early"],
  영상: ["video", "scene", "frame", "moment"],
  스토리: ["story", "scene", "event", "part"],
  이야기: ["story", "scene", "event", "part"],
  내용: ["story", "part", "scene", "event"],
  무슨: ["what", "which", "무엇", "어떤"],
  뭐야: ["what", "which", "무슨", "어떤"],
  맞아: ["right", "really", "actual", "진짜"],
  맞지: ["right", "really", "actual", "진짜"],
};

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

function expandTokens(taskId: TaskId, text: string): string[] {
  const expanded = new Set(expandQueryTerms(taskId, text));

  for (const token of [...expanded]) {
    const related = GENERIC_QUERY_EXPANSIONS[token] || [];

    for (const item of related) {
      for (const nextToken of tokenize(item)) {
        expanded.add(nextToken);
      }
    }
  }

  return [...expanded];
}

function scoreChunk(taskId: TaskId, query: string, content: string): number {
  const queryTokens = new Set(expandTokens(taskId, query));
  const contentTokens = tokenize(content);
  let score = 0;

  for (const token of contentTokens) {
    if (queryTokens.has(token)) {
      score += 1;
    }
  }

  return score;
}

function detectSegmentIntent(query: string): "beginning" | "middle" | "end" | null {
  const normalized = normalize(query);

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

function segmentPositionBoost(chunk: TaskChunk, maxChunkIndex: number, preferredSegments: string[]): number {
  if (maxChunkIndex <= 0 || preferredSegments.length === 0) {
    return 0;
  }

  const ratio = chunk.chunkIndex / maxChunkIndex;
  let boost = 0;

  if (preferredSegments.includes("beginning")) {
    boost = Math.max(boost, (1 - ratio) * 1.5);
  }

  if (preferredSegments.includes("middle")) {
    boost = Math.max(boost, (1 - Math.abs(ratio - 0.5) * 2) * 1.5);
  }

  if (preferredSegments.includes("end")) {
    boost = Math.max(boost, ratio * 1.5);
  }

  return Math.max(0, boost);
}

export function retrieveTaskChunks(
  taskId: TaskId,
  query: string,
  condition: TaskCondition,
  limit = 4
): RetrievedChunk[] {
  const taskPackage = loadTaskPackage(taskId, condition);
  const conditionConfig = taskPackage.config.conditions[condition];

  if (!conditionConfig.retrieval_enabled) {
    return [];
  }

  const chunks = chunkDocuments(taskPackage.config.task_id, taskPackage.documents);
  const maxChunkIndex = chunks.reduce((max, chunk) => Math.max(max, chunk.chunkIndex), 0);
  const explicitSegment = detectSegmentIntent(query);
  const lexiconSegments = detectLexiconSegments(taskId, query);
  const preferredSegments = explicitSegment ? [explicitSegment] : lexiconSegments;

  const ranked = chunks
    .map((chunk) => ({
      ...chunk,
      score:
        scoreChunk(taskId, query, chunk.content) +
        segmentPositionBoost(chunk, maxChunkIndex, preferredSegments),
    }))
    .sort((a, b) => b.score - a.score);

  const positive = ranked.filter((chunk) => chunk.score > 0).slice(0, limit);

  if (positive.length > 0) {
    return positive;
  }

  if (preferredSegments.includes("end")) {
    return [...chunks]
      .sort((a, b) => b.chunkIndex - a.chunkIndex)
      .slice(0, Math.min(limit, chunks.length))
      .map((chunk) => ({ ...chunk, score: 0 }));
  }

  if (preferredSegments.includes("beginning")) {
    return [...chunks]
      .sort((a, b) => a.chunkIndex - b.chunkIndex)
      .slice(0, Math.min(limit, chunks.length))
      .map((chunk) => ({ ...chunk, score: 0 }));
  }

  if (preferredSegments.includes("middle")) {
    return [...chunks]
      .sort(
        (a, b) =>
          Math.abs(a.chunkIndex - maxChunkIndex / 2) - Math.abs(b.chunkIndex - maxChunkIndex / 2)
      )
      .slice(0, Math.min(limit, chunks.length))
      .map((chunk) => ({ ...chunk, score: 0 }));
  }

  return ranked.slice(0, Math.min(2, ranked.length));
}
