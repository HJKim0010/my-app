import fs from "node:fs";
import path from "node:path";
import type { TaskId } from "@/backend/rag/loader";

export type StorySegment = "beginning" | "middle" | "end";
export type LexiconCategory =
  | "character"
  | "object"
  | "place"
  | "action"
  | "problem"
  | "feeling"
  | "decision"
  | "theme"
  | "question";

export type LexiconEntry = {
  id: string;
  category: LexiconCategory;
  canonical?: string;
  terms: string[];
  related: string[];
  korean_terms?: string[];
  english_terms?: string[];
  mixed_terms?: string[];
  question_forms?: string[];
  actions?: string[];
  feelings?: string[];
  priority?: number;
  segments?: StorySegment[];
};

type LexiconFile = {
  version?: number;
  taskId?: TaskId;
  entries?: LexiconEntry[];
};

const cache = new Map<TaskId, LexiconEntry[]>();

const PARTICLE_SUFFIXES = [
  "으로",
  "로",
  "에서",
  "에게",
  "한테",
  "이랑",
  "랑",
  "은",
  "는",
  "이",
  "가",
  "을",
  "를",
  "와",
  "과",
  "도",
  "만",
] as const;

function lexiconPath(taskId: TaskId): string {
  return path.join(process.cwd(), "data", taskId, `${taskId}-lexicon.json`);
}

export function normalizeLexiconText(text: string): string {
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

function stripParticle(token: string): string {
  for (const suffix of PARTICLE_SUFFIXES) {
    if (token.endsWith(suffix) && token.length > suffix.length + 1) {
      return token.slice(0, -suffix.length);
    }
  }

  return token;
}

export function tokenizeLexiconText(text: string): string[] {
  return normalizeLexiconText(text)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean)
    .map(stripParticle)
    .filter(Boolean);
}

export function loadTaskLexicon(taskId: TaskId): LexiconEntry[] {
  const cached = cache.get(taskId);
  if (cached) {
    return cached;
  }

  const filePath = lexiconPath(taskId);
  if (!fs.existsSync(filePath)) {
    cache.set(taskId, []);
    return [];
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as LexiconFile;
  const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
  cache.set(taskId, entries);
  return entries;
}

function collectEntrySearchTerms(entry: LexiconEntry): string[] {
  return [
    entry.canonical || "",
    ...(entry.terms || []),
    ...(entry.related || []),
    ...(entry.korean_terms || []),
    ...(entry.english_terms || []),
    ...(entry.mixed_terms || []),
    ...(entry.question_forms || []),
    ...(entry.actions || []),
    ...(entry.feelings || []),
  ].filter(Boolean);
}

function countMatchedTerms(
  terms: string[] | undefined,
  queryTokens: Set<string>,
  weight: number
): number {
  let score = 0;

  for (const term of terms || []) {
    const tokens = tokenizeLexiconText(term);
    if (!tokens.length) {
      continue;
    }

    if (tokens.some((token) => queryTokens.has(token))) {
      score += weight;
    }
  }

  return score;
}

function scoreLexiconEntry(entry: LexiconEntry, query: string): number {
  const queryTokens = new Set(tokenizeLexiconText(query));

  if (!queryTokens.size) {
    return 0;
  }

  let score = 0;

  if (entry.canonical) {
    score += countMatchedTerms([entry.canonical], queryTokens, 3);
  }

  score += countMatchedTerms(entry.terms, queryTokens, 3);
  score += countMatchedTerms(entry.question_forms, queryTokens, 4);
  score += countMatchedTerms(entry.korean_terms, queryTokens, 3);
  score += countMatchedTerms(entry.english_terms, queryTokens, 3);
  score += countMatchedTerms(entry.mixed_terms, queryTokens, 3);
  score += countMatchedTerms(entry.related, queryTokens, 2);
  score += countMatchedTerms(entry.actions, queryTokens, 1);
  score += countMatchedTerms(entry.feelings, queryTokens, 1);
  score += entry.priority || 0;

  return score;
}

export function findMatchingLexiconEntries(taskId: TaskId, query: string): LexiconEntry[] {
  const entries = loadTaskLexicon(taskId);

  return entries
    .map((entry) => ({
      entry,
      score: scoreLexiconEntry(entry, query),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .map(({ entry }) => entry);
}

export function expandQueryTerms(taskId: TaskId, query: string): string[] {
  const expanded = new Set(tokenizeLexiconText(query));

  for (const entry of findMatchingLexiconEntries(taskId, query)) {
    for (const term of collectEntrySearchTerms(entry)) {
      for (const token of tokenizeLexiconText(term)) {
        expanded.add(token);
      }
    }
  }

  return [...expanded];
}

export function detectLexiconSegments(taskId: TaskId, query: string): StorySegment[] {
  const segments = new Set<StorySegment>();

  for (const entry of findMatchingLexiconEntries(taskId, query)) {
    for (const segment of entry.segments || []) {
      segments.add(segment);
    }
  }

  return [...segments];
}

export function explainLexiconMatches(
  taskId: TaskId,
  query: string
): Array<{ id: string; canonical: string; score: number }> {
  const entries = loadTaskLexicon(taskId);

  return entries
    .map((entry) => ({
      id: entry.id,
      canonical: entry.canonical || entry.id,
      score: scoreLexiconEntry(entry, query),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
}
