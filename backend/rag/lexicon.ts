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
  | "decision";

export type LexiconEntry = {
  id: string;
  category: LexiconCategory;
  terms: string[];
  related: string[];
  segments?: StorySegment[];
};

type LexiconFile = {
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

export function findMatchingLexiconEntries(taskId: TaskId, query: string): LexiconEntry[] {
  const queryTokens = new Set(tokenizeLexiconText(query));
  const entries = loadTaskLexicon(taskId);

  return entries.filter((entry) => {
    const combined = [...entry.terms, ...entry.related];
    return combined.some((term) =>
      tokenizeLexiconText(term).some((token) => queryTokens.has(token))
    );
  });
}

export function expandQueryTerms(taskId: TaskId, query: string): string[] {
  const expanded = new Set(tokenizeLexiconText(query));

  for (const entry of findMatchingLexiconEntries(taskId, query)) {
    for (const term of [...entry.terms, ...entry.related]) {
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
