import {
  detectLexiconSegments,
  findMatchingLexiconEntries,
  normalizeLexiconText,
  type StorySegment,
} from "@/backend/rag/lexicon";
import type { TaskId } from "@/backend/rag/loader";

export type RecentMessage = {
  role: "user" | "assistant";
  text: string;
};

export type ConversationMemory = {
  recentSummary: string;
  activeEntities: string[];
  activeScene: StorySegment | null;
  lastUserFocus: string;
};

const MAX_MESSAGES = 5;
const VAGUE_REFERENCE_PATTERNS = [
  /\b(it|that|this|inside|there|they|them)\b/i,
  /(그거|그것|그 안|그 장면|그 부분|저거|저것|걔|그 다음|왜 그랬)/,
];

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function extractTopEntities(taskId: TaskId, text: string, limit = 4): string[] {
  return findMatchingLexiconEntries(taskId, text)
    .slice(0, limit)
    .map((entry) => entry.canonical || entry.id)
    .filter(Boolean);
}

function detectScene(taskId: TaskId, text: string): StorySegment | null {
  const segments = detectLexiconSegments(taskId, text);
  return segments[0] || null;
}

function looksLikeVagueFollowUp(text: string): boolean {
  const normalized = compactText(text);
  if (!normalized) {
    return false;
  }

  return VAGUE_REFERENCE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function buildRecentSummary(recentMessages: RecentMessage[]): string {
  return recentMessages
    .slice(-MAX_MESSAGES)
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${compactText(message.text)}`)
    .join("\n");
}

export function buildConversationMemory(
  taskId: TaskId,
  query: string,
  recentMessages: RecentMessage[]
): ConversationMemory {
  const normalizedQuery = normalizeLexiconText(query);
  const summary = buildRecentSummary(recentMessages);
  const recentUserMessages = recentMessages.filter((message) => message.role === "user");
  const lastUserText = compactText(recentUserMessages[recentUserMessages.length - 1]?.text || "");
  const previousUserText = compactText(
    recentUserMessages[recentUserMessages.length - 2]?.text || ""
  );

  const entitySourceText =
    looksLikeVagueFollowUp(query) && previousUserText
      ? `${previousUserText}\n${lastUserText}\n${query}`
      : `${lastUserText}\n${query}`;

  const activeEntities = [
    ...new Set([
      ...extractTopEntities(taskId, entitySourceText, 5),
      ...extractTopEntities(taskId, summary, 3),
    ]),
  ].slice(0, 6);

  const activeScene =
    detectScene(taskId, query) ||
    detectScene(taskId, lastUserText) ||
    detectScene(taskId, summary) ||
    null;

  const lastUserFocus =
    normalizedQuery && !looksLikeVagueFollowUp(query)
      ? compactText(query)
      : previousUserText || lastUserText || compactText(query);

  return {
    recentSummary: summary || "(No recent conversation context)",
    activeEntities,
    activeScene,
    lastUserFocus: lastUserFocus || compactText(query),
  };
}
