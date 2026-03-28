import fs from "node:fs";
import path from "node:path";
import type { TaskId } from "@/backend/rag/loader";

export type StorySegment = "beginning" | "middle" | "end";

export type LexiconEntry = {
  id: string;
  category: "character" | "object" | "place" | "action" | "problem" | "feeling" | "decision";
  terms: string[];
  related: string[];
  segments?: StorySegment[];
};

export type TaskLexicon = {
  entries: LexiconEntry[];
};

const EMPTY_LEXICON: TaskLexicon = {
  entries: [],
};

function getLexiconPath(taskId: TaskId): string {
  return path.join(process.cwd(), "data", taskId, `${taskId}-lexicon.json`);
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/([a-z])([\uac00-\ud7a3])/g, "$1 $2")
    .replace(/([\uac00-\ud7a3])([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9\uac00-\ud7a3\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return normalize(text)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

export function loadTaskLexicon(taskId: TaskId): TaskLexicon {
  const fullPath = getLexiconPath(taskId);

  if (!fs.existsSync(fullPath)) {
    return EMPTY_LEXICON;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8")) as TaskLexicon;
    return Array.isArray(parsed.entries) ? parsed : EMPTY_LEXICON;
  } catch {
    return EMPTY_LEXICON;
  }
}

export function findMatchingLexiconEntries(taskId: TaskId, text: string): LexiconEntry[] {
  const lexicon = loadTaskLexicon(taskId);
  const normalizedText = normalize(text);
  const tokens = new Set(tokenize(text));

  return lexicon.entries.filter((entry) => {
    const candidates = [...entry.terms, ...entry.related];

    return candidates.some((candidate) => {
      const normalizedCandidate = normalize(candidate);

      if (!normalizedCandidate) {
        return false;
      }

      if (normalizedText.includes(normalizedCandidate)) {
        return true;
      }

      return tokenize(candidate).some((token) => tokens.has(token));
    });
  });
}

export function expandQueryTerms(taskId: TaskId, text: string): string[] {
  const tokens = new Set(tokenize(text));
  const matches = findMatchingLexiconEntries(taskId, text);

  for (const entry of matches) {
    for (const term of [...entry.terms, ...entry.related]) {
      for (const token of tokenize(term)) {
        tokens.add(token);
      }
    }
  }

  return [...tokens];
}

export function detectLexiconSegments(taskId: TaskId, text: string): StorySegment[] {
  const matches = findMatchingLexiconEntries(taskId, text);
  const segments = new Set<StorySegment>();

  for (const entry of matches) {
    for (const segment of entry.segments || []) {
      segments.add(segment);
    }
  }

  return [...segments];
}
