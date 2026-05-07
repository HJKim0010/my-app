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
export type ActiveSupportContext = "sentence_translation" | null;

export type ConversationMemory = {
  recentSummary: string;
  activeEntities: string[];
  activeScene: StorySegment | null;
  lastUserFocus: string;
  workingContext: WorkingContext;
  continuationFocus: string;
  activeSupportContext: ActiveSupportContext;
  isContextualFollowUp: boolean;
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

function asksForDirectTranslation(text: string): boolean {
  return /(in english|translate|translation|\uc601\uc5b4\ub85c|\ubc88\uc5ed)/i.test(text);
}

function looksLikeKoreanSentence(text: string): boolean {
  const koreanChars = text.match(/[\uac00-\ud7a3]/g)?.length ?? 0;
  return koreanChars >= 6 && /[\s.!?。]|(\ub2e4|\ub2e4\.|\uc694|\uc5b4|\ud574|\ud588\ub2e4|\ud588\uc5b4|\ud588\uc694)/.test(text);
}

function looksLikeSentenceTranslationRequest(text: string): boolean {
  return asksForDirectTranslation(text) && looksLikeKoreanSentence(text);
}

function looksLikeTranslationRedirect(text: string): boolean {
  return (
    text.includes("Pattern: [Subject]") ||
    /full Korean sentence|direct full-sentence translation|ready-to-use English sentence/i.test(text) ||
    /문장 전체|핵심 패턴|영어로 바꿔주지/.test(text)
  );
}

function looksLikeLanguageFollowUp(text: string): boolean {
  const normalized = compactText(text);

  if (!normalized || normalized.length > 40) {
    return false;
  }

  return /(hint|hints|clue|help|example|pattern|more|좀|힌트|도움|예시|패턴|조금|더|어떻게|알려줘|알려주세요)/i.test(
    normalized
  );
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
  const recentAssistantMessages = recentMessages.filter((message) => message.role === "assistant");
  const lastUserText = compactText(recentUserMessages[recentUserMessages.length - 1]?.text || "");
  const previousUserText = compactText(
    recentUserMessages[recentUserMessages.length - 2]?.text || ""
  );
  const lastAssistantText = compactText(
    recentAssistantMessages[recentAssistantMessages.length - 1]?.text || ""
  );
  const activeSupportContext: ActiveSupportContext =
    looksLikeSentenceTranslationRequest(lastUserText) || looksLikeTranslationRedirect(lastAssistantText)
      ? "sentence_translation"
      : null;
  const isContextualFollowUp =
    activeSupportContext === "sentence_translation" && looksLikeLanguageFollowUp(query);

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
    isContextualFollowUp
      ? lastUserText || previousUserText || compactText(query)
      : looksLikeAcknowledgment(query)
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
    activeSupportContext,
    isContextualFollowUp,
  };
}
