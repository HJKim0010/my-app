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
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
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

  const ranked = chunks
    .map((chunk) => ({
      ...chunk,
      score: scoreChunk(query, chunk.content),
    }))
    .sort((a, b) => b.score - a.score);

  const positive = ranked.filter((chunk) => chunk.score > 0).slice(0, limit);

  if (positive.length > 0) {
    return positive;
  }

  return ranked.slice(0, Math.min(2, ranked.length));
}
