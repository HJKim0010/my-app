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
export type ActiveSupportContext =
  | "comprehension"
  | "ideas"
  | "organization"
  | "language"
  | "feedback"
  | "sentence_translation"
  | null;

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

const MAX_MESSAGES = 12;
const VAGUE_REFERENCE_PATTERNS = [
  /\b(it|that|this|inside|there|they|them)\b/i,
  /(그거|그건|이거|이건|저거|저건|아까|방금|전에|그 부분|이 부분|그 문장|그 아이디어|그 전개)/,
];
const ACKNOWLEDGMENT_PATTERNS = [
  /^(yes|yeah|yep|ok|okay|sure|right|got it)$/i,
  /^(ㅇㅇ|응|응\?|네|넵|예|그래|맞아|맞아요|알겠어|알겠어요|좋아|좋아요)$/i,
] as const;
const USER_CONTINUATION_PATTERNS = [
  /(my continuation|my idea|my writing|my draft|what i wrote|based on what i wrote|based on my idea)/i,
  /(내가 만든 이야기|내가 만든 내용|내가 쓴 전개|내가 쓴 글|내 글|내 작문|내 라이팅|내 초안|내 아이디어|그냥 내 전개|이어쓰기)/,
  /(자료 말고|원문 말고|source 말고|내가 만든 거라|내가 원하는 전개)/,
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
    looksLikeLearnerSelectedDirection(normalized) ||
    (normalized.length > 80 && /(\bthen\b|\bafter that\b|\bfinally\b|그리고|그 다음|이후)/i.test(normalized))
  ) {
    return true;
  }

  return false;
}

function looksLikeLearnerSelectedDirection(text: string): boolean {
  const normalized = compactText(text);

  return /(go back home|return home|go home|continue to school|go to school|go back|집에\s*다시|집으로|집에\s*돌아|돌아가|되돌아|학생증.*가지러|지갑.*가지러|학교로|계속\s*가|가야\s*하|어쩔\s*수\s*없이|할\s*수\s*없이|전개|방향|흐름|사건|아이디어|어때)/i.test(
    normalized
  );
}

function looksLikeDirectionFollowUp(text: string): boolean {
  const normalized = compactText(text);

  return /(그쪽|그걸로|그렇게|그러면|근데|but|then|그래도|어쩔\s*수\s*없이|할\s*수\s*없이|가야\s*하|돌아가야|계속\s*가야|학생증.*가지러|지갑.*가지러|must go|have to go|has to go)/i.test(
    normalized
  );
}

function asksForDirectTranslation(text: string): boolean {
  return /(in english|translate|translation|\uc601\uc5b4\ub85c|\ubc88\uc5ed)/i.test(text);
}

function looksLikeKoreanSentence(text: string): boolean {
  const koreanChars = text.match(/[\uac00-\ud7a3]/g)?.length ?? 0;
  return (
    koreanChars >= 6 &&
    /[\s.!?。！？]|(다|다\.|요|어|해|했다|했어|했어요)$/.test(text)
  );
}
function looksLikeSentenceTranslationRequest(text: string): boolean {
  return asksForDirectTranslation(text) && looksLikeKoreanSentence(text);
}

function looksLikeTranslationRedirect(text: string): boolean {
  return (
    text.includes("Pattern: [Subject]") ||
    /full Korean sentence|blank sentence frame|learner should assemble/i.test(text) ||
    /문장 전체|핵심 패턴|영어로 바꿔주지/.test(text)
  );
}
function looksLikeShortContextualFollowUp(text: string): boolean {
  const normalized = compactText(text);

  if (!normalized || normalized.length > 60) {
    return false;
  }

  return /(hint|hints|clue|help|example|pattern|more|why|how|what about|then|next|again|check|huh|what\?|but|have to go|must go|좀|힌트|도움|예시|패턴|조금|더|왜|어떻게|그럼|그러면|근데|그래도|어쩔\s*수\s*없이|할\s*수\s*없이|가야\s*하|학생증.*가지러|지갑.*가지러|다음|다시|확인|괜찮|알려줘|알려주세요|뭐라고|무슨 뜻|헐|ㅇㅇ|응\?)/i.test(
    normalized
  );
}
function inferSupportContext(text: string): ActiveSupportContext {
  const normalized = compactText(text).toLowerCase();

  if (!normalized) {
    return null;
  }

  if (looksLikeSentenceTranslationRequest(text) || looksLikeTranslationRedirect(text)) {
    return "sentence_translation";
  }

  if (/(feedback|check|grammar|awkward|logical|logic|natural|revise|문법|어색|논리|자연|피드백|확인|괜찮|내 글|내 작문|내 라이팅|내 초안)/i.test(normalized)) {
    return "feedback";
  }

  if (/(translate|in english|how do i say|pattern|sentence structure|word|expression|vocabulary|phrase|영어로|번역|표현|단어|패턴|문장 구조)/i.test(normalized)) {
    return "language";
  }

  if (/(organize|organization|structure|outline|flow|sequence|order|beginning|middle|end|구성|구조|흐름|순서|정리|처음|중간|끝)/i.test(normalized)) {
    return "organization";
  }

  if (/(idea|ideas|next event|possible|what could happen|brainstorm|clue|hint|direction|plan|go back home|return home|go home|아이디어|다음 사건|다음 전개|전개|방향|사건|계획|가능|단서|힌트|집에\s*다시|집으로|집에\s*돌아|돌아가)/i.test(normalized)) {
    return "ideas";
  }

  if (/(understand|meaning|what does|which part|scene|story detail|이해|무슨 뜻|어느 부분|장면|내용|단서가 뭐)/i.test(normalized)) {
    return "comprehension";
  }

  return null;
}
function inferExplicitSupportShift(text: string): ActiveSupportContext {
  const normalized = compactText(text).toLowerCase();

  if (!normalized) {
    return null;
  }

  if (looksLikeSentenceTranslationRequest(text)) {
    return "sentence_translation";
  }

  if (/(translate|in english|how do i say|pattern|sentence structure|word|expression|vocabulary|phrase|영어로|번역|표현|단어|패턴|문장 구조)/i.test(normalized)) {
    return "language";
  }

  if (/(feedback|check|grammar|awkward|logical|logic|natural|문법|어색|논리|자연|피드백|확인해|내 글|내 작문|내 라이팅|내 초안)/i.test(normalized)) {
    return "feedback";
  }

  if (/(organize|organization|structure|outline|flow|sequence|order|구성|구조|흐름|순서|정리)/i.test(normalized)) {
    return "organization";
  }

  if (/(idea|ideas|next event|possible|what could happen|brainstorm|go back home|return home|go home|아이디어|다음 사건|다음 전개|가능한 전개|집에\s*다시|집으로|집에\s*돌아|돌아가)/i.test(normalized)) {
    return "ideas";
  }

  if (/(understand|meaning|what does|which part|scene|story detail|이해|무슨 뜻|어느 부분|장면|내용)/i.test(normalized)) {
    return "comprehension";
  }

  return null;
}
function shouldKeepPreviousContext(
  activeSupportContext: ActiveSupportContext,
  explicitShift: ActiveSupportContext
): boolean {
  if (!activeSupportContext) {
    return false;
  }

  if (!explicitShift) {
    return true;
  }

  if (activeSupportContext === explicitShift) {
    return true;
  }

  return activeSupportContext === "sentence_translation" && explicitShift === "language";
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

  if (looksLikeLearnerSelectedDirection(lastUserText) && looksLikeDirectionFollowUp(query)) {
    return compactText([lastUserText, query].filter(Boolean).join(" / follow-up: "));
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
    inferSupportContext(lastUserText) || inferSupportContext(lastAssistantText);
  const explicitShift = inferExplicitSupportShift(query);
  const isContextualFollowUp =
    looksLikeShortContextualFollowUp(query) &&
    shouldKeepPreviousContext(activeSupportContext, explicitShift);

  const entitySourceText =
    (looksLikeVagueFollowUp(query) || isContextualFollowUp) && previousUserText
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
