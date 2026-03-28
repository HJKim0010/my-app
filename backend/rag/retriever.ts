import { chunkDocuments, type TaskChunk } from "@/backend/rag/chunker";
import { loadTaskPackage, type TaskCondition, type TaskId } from "@/backend/rag/loader";

export type RetrievedChunk = TaskChunk & {
  score: number;
};

const QUERY_EXPANSIONS: Record<string, string[]> = {
  busy: ["prepare", "preparing", "presentation", "project", "team", "lead"],
  late: ["alarm", "alarms", "clock", "morning", "woke", "sunlight"],
  worried: ["tense", "nervous", "warning", "decision"],
  problem: ["conflict", "warning", "decision", "late"],
  ending: ["last", "final", "decision", "warning", "station"],
  last: ["ending", "final", "warning", "station", "decision"],
  final: ["ending", "last", "decision", "station", "graduation"],
  anna: ["package", "box", "book", "note", "table", "cafe"],
  jack: ["train", "warning", "station", "note", "decision", "team"],
  story: ["scene", "part", "moment", "event"],
  video: ["scene", "moment", "frame", "last", "final"],
  scene: ["video", "moment", "frame"],
  마지막: ["끝", "last", "final", "ending", "decision", "warning", "station"],
  끝: ["마지막", "last", "final", "ending"],
  마지막부분: ["마지막", "끝", "last", "final", "ending"],
  마지막장면: ["마지막", "scene", "last", "final"],
  후반: ["마지막", "끝", "late", "later", "final"],
  초반: ["처음", "beginning", "start", "early"],
  처음: ["초반", "beginning", "start", "early"],
  영상: ["video", "scene", "frame", "moment"],
  스토리: ["story", "scene", "event", "part"],
  이야기: ["story", "scene", "event", "part"],
  문제: ["problem", "conflict", "warning", "decision"],
  내용: ["story", "part", "scene", "event"],
  지하철: ["train", "subway", "wallet", "student", "id", "forgot"],
  subway: ["train", "wallet", "student", "id", "forgot"],
  train: ["subway", "wallet", "student", "id", "note", "woman"],
  forgot: ["wallet", "student", "id", "left", "behind"],
  잊어버린: ["forgot", "wallet", "student", "id"],
  두고: ["forgot", "wallet", "student", "id", "left"],
  지갑: ["wallet", "student", "id", "forgot"],
  학생증: ["student", "id", "wallet", "forgot"],
  중요한거: ["wallet", "student", "id", "bag", "laptop"],
  중요한: ["wallet", "student", "id", "bag", "laptop"],
  package: ["box", "note", "book", "table", "anna"],
  box: ["package", "note", "book", "table", "anna"],
  상자: ["box", "package", "note", "book", "anna"],
  카페: ["cafe", "box", "package", "table", "anna"],
  cafe: ["box", "package", "table", "anna"],
  note: ["book", "table", "anna", "message"],
  table: ["note", "book", "package", "anna"],
  망설여: ["hesitate", "nervous", "uncertain", "anna"],
  망설임: ["hesitate", "nervous", "uncertain", "anna"],
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/([a-z])([\uac00-\ud7a3])/g, "$1 $2")
    .replace(/([\uac00-\ud7a3])([a-z])/g, "$1 $2")
    .replace(/([0-9])([\uac00-\ud7a3a-z])/g, "$1 $2")
    .replace(/([\uac00-\ud7a3a-z])([0-9])/g, "$1 $2")
    .replace(/[^a-z0-9\uac00-\ud7a3\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function expandTokens(tokens: string[]): string[] {
  const expanded = new Set(tokens);

  for (const token of tokens) {
    const related = QUERY_EXPANSIONS[token] || [];

    for (const item of related) {
      expanded.add(item);
    }
  }

  return [...expanded];
}

function scoreChunk(query: string, content: string): number {
  const queryTokens = new Set(expandTokens(tokenize(query)));
  const contentTokens = tokenize(content);
  let score = 0;

  for (const token of contentTokens) {
    if (queryTokens.has(token)) {
      score += 1;
    }
  }

  return score;
}

function hasLastPartIntent(query: string): boolean {
  const normalized = query.toLowerCase();
  return [
    "last",
    "final",
    "ending",
    "end",
    "마지막",
    "마지막부분",
    "마지막 장면",
    "끝",
    "후반",
  ].some((term) => normalized.includes(term));
}

function hasBeginningIntent(query: string): boolean {
  const normalized = query.toLowerCase();
  return ["beginning", "start", "first", "initial", "처음", "초반", "앞부분"].some((term) =>
    normalized.includes(term)
  );
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
  const prefersLastPart = hasLastPartIntent(query);
  const prefersBeginning = hasBeginningIntent(query);

  const ranked = chunks
    .map((chunk) => ({
      ...chunk,
      score:
        scoreChunk(query, chunk.content) +
        (prefersLastPart && maxChunkIndex > 0
          ? (chunk.chunkIndex / maxChunkIndex) * 1.75
          : 0) +
        (prefersBeginning && maxChunkIndex > 0
          ? ((maxChunkIndex - chunk.chunkIndex) / maxChunkIndex) * 1.75
          : 0),
    }))
    .sort((a, b) => b.score - a.score);

  const positive = ranked.filter((chunk) => chunk.score > 0).slice(0, limit);

  if (positive.length > 0) {
    return positive;
  }

  if (prefersLastPart) {
    return [...chunks]
      .sort((a, b) => b.chunkIndex - a.chunkIndex)
      .slice(0, Math.min(limit, chunks.length))
      .map((chunk) => ({
        ...chunk,
        score: 0,
      }));
  }

  if (prefersBeginning) {
    return [...chunks]
      .sort((a, b) => a.chunkIndex - b.chunkIndex)
      .slice(0, Math.min(limit, chunks.length))
      .map((chunk) => ({
        ...chunk,
        score: 0,
      }));
  }

  return ranked.slice(0, Math.min(2, ranked.length));
}
