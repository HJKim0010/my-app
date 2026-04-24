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

export type WorkingContext = "source" | "user_continuation";

export type ConversationMemory = {
  recentSummary: string;
  activeEntities: string[];
  activeScene: StorySegment | null;
  lastUserFocus: string;
  workingContext: WorkingContext;
  continuationFocus: string;
};

const MAX_MESSAGES = 5;
const VAGUE_REFERENCE_PATTERNS = [/\b(it|that|this|inside|there|they|them)\b/i];
const ACKNOWLEDGMENT_PATTERNS = [
  /^(yes|yeah|yep|ok|okay|sure|right|got it)$/i,
  /^(응|ㅇㅇ|네|맞아|그래|알겠어|좋아)$/i,
] as const;
const USER_CONTINUATION_PATTERNS = [
  /(my continuation|my idea|based on what i wrote|based on my idea)/i,
  /(내가 만든 이야기|내가 만든 내용|내가 짠 전개|내가 쓴 글|내 전개|뒷이야기)/,
  /(자료 얘기 그만해|source 말고|내가 만든 거라니까|그냥 내 전개 봐줘)/,
] as const;

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

function looksLikeAcknowledgment(text: string): boolean {
  const normalized = compactText(text);
  return ACKNOWLEDGMENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

function looksLikeUserContinuation(text: string): boolean {
  const normalized = compactText(text);

  if (
    USER_CONTINUATION_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    (normalized.length > 80 && /(\bthen\b|\bafter that\b|\bfinally\b|그리고|그 다음|이후)/i.test(normalized))
  ) {
    return true;
  }

  return false;
}

function buildRecentSummary(recentMessages: RecentMessage[]): string {
  return recentMessages
    .slice(-MAX_MESSAGES)
    .map(
      (message) => `${message.role === "user" ? "User" : "Assistant"}: ${compactText(message.text)}`
    )
    .join("\n");
}

function findContinuationFocus(query: string, lastUserText: string, previousUserText: string): string {
  if (looksLikeAcknowledgment(query)) {
    return previousUserText || lastUserText;
  }

  if (looksLikeUserContinuation(query)) {
    return compactText(query);
  }

  if (looksLikeUserContinuation(lastUserText)) {
    return lastUserText;
  }

  return "";
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
    looksLikeAcknowledgment(query)
      ? previousUserText || lastUserText || compactText(query)
      : normalizedQuery && !looksLikeVagueFollowUp(query)
        ? compactText(query)
        : previousUserText || lastUserText || compactText(query);

  const continuationFocus = findContinuationFocus(query, lastUserText, previousUserText);
  const workingContext = continuationFocus ? "user_continuation" : "source";

  return {
    recentSummary: summary || "(No recent conversation context)",
    activeEntities,
    activeScene,
    lastUserFocus: lastUserFocus || compactText(query),
    workingContext,
    continuationFocus,
  };
}
