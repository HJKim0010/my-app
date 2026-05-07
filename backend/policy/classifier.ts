export type QueryType = "allowed" | "restricted";

export type RestrictionReason =
  | "sentence_generation"
  | "sentence_translation"
  | "draft_rewrite"
  | "outside_content";

const CONTINUATION_SUPPORT_SIGNALS = [
  "what can happen next",
  "what happens next",
  "possible next",
  "possible continuation",
  "next event",
  "next scene",
  "next idea",
  "story flow",
  "plot flow",
  "plot outline",
  "clue",
  "hint",
  "use the clue",
  "given clue",
  "think before acting",
  "thought before acting",
  "natural flow",
  "problem solving",
  "resolve the problem",
  "does this flow make sense",
  "is this logical",
  "does this make sense",
  "organize this story",
  "organize my continuation",
  "my continuation",
  "my story",
  "my idea",
  "based on my idea",
  "based on what i wrote",
  "check this flow",
  "check the logic",
  "check my grammar",
  "grammar check",
  "source 말고",
  "자료 얘기 그만해",
  "내가 만든 이야기",
  "내가 만든 내용",
  "내가 짠 전개",
  "내가 쓴 글",
  "내 전개",
  "이어쓰기",
  "쓰기 과제",
  "글쓰기 과제",
  "다음에 가능한 전개",
  "다음 전개",
  "다음 장면",
  "뒷이야기",
  "단서",
  "힌트",
  "단서 활용",
  "행동 전에",
  "생각하고",
  "자연스러운 흐름",
  "문제 해결",
  "뒤에 뭐가",
  "어떻게 이어",
  "흐름이",
  "말이 돼",
  "이렇게 가면",
  "문법적으로",
  "어색한 부분",
  "표현이 자연",
] as const;

const sentenceGenerationPatterns = [
  "write the next",
  "write next",
  "continue the story for me",
  "continue it for me",
  "finish the story",
  "give me a paragraph",
  "write a paragraph",
  "write the paragraph",
  "write a sentence",
  "give me a sentence",
  "complete the sentence",
  "complete this for me",
  "do it for me",
  "write it for me",
  "answer for me",
  "generate the answer",
  "give me the answer",
  "model answer",
  "sample answer",
  "example answer",
  "full answer",
  "write the continuation",
  "write my answer",
  "write based on this",
  "write from this",
  "write using this",
] as const;

const draftRewritePatterns = [
  "rewrite my draft",
  "rewrite my writing",
  "rewrite the whole draft",
  "rewrite the whole thing",
  "polish my draft",
  "revise my whole draft",
  "edit my whole draft",
  "fix the whole draft",
  "rewrite this whole paragraph",
  "rewrite this paragraph for me",
  "rewrite this essay",
  "improve my whole draft",
  "correct everything",
  "translate this paragraph into english",
  "translate this into english writing",
] as const;

const outsideContentPatterns = [
  "add new background",
  "give outside ideas",
  "use outside knowledge",
  "based on real life",
  "what usually happens in real life",
  "what would people normally do",
  "cultural background",
  "extra background knowledge",
] as const;

function includesAny(query: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => query.includes(pattern));
}

function hasContinuationSupportSignal(query: string): boolean {
  return includesAny(query, CONTINUATION_SUPPORT_SIGNALS);
}

function mentionsFeedbackStyleHelp(query: string): boolean {
  return /(grammar|logic|flow|make sense|natural|unclear|awkward|clue|hint|문법|논리|흐름|어색|자연|단서|힌트|말이 되)/.test(
    query
  );
}

function mentionsPlanningHelp(query: string): boolean {
  return /(idea|ideas|outline|structure|flow|plan|possible|organization|plot|clue|hint|next event|next scene|problem solving|구성|전개|흐름|아이디어|가능한|단서|힌트|다음 장면|문제 해결|이어쓰기)/.test(
    query
  );
}

function asksForDirectTranslation(query: string): boolean {
  return /(in english|translate|translation|\uc601\uc5b4\ub85c|\ubc88\uc5ed)/i.test(query);
}

function looksLikeKoreanSentence(query: string): boolean {
  const koreanChars = query.match(/[\uac00-\ud7a3]/g)?.length ?? 0;
  const hasSentenceShape =
    /[\s.!?。]|(\ub2e4|\ub2e4\.|\uc694|\uc5b4|\ud574|\ud588\ub2e4|\ud588\uc5b4|\ud588\uc694)/.test(query);

  return koreanChars >= 6 && hasSentenceShape;
}

export function detectRestrictionReason(query: string): RestrictionReason | null {
  const q = query.toLowerCase();
  const continuationSupport = hasContinuationSupportSignal(q);

  if (asksForDirectTranslation(query) && looksLikeKoreanSentence(query)) {
    return "sentence_translation";
  }

  if (
    (includesAny(q, draftRewritePatterns) ||
      (/(my draft|my writing|this essay|whole paragraph|whole draft)/.test(q) &&
        /(rewrite|polish|edit|improve|correct|translate)/.test(q))) &&
    !continuationSupport &&
    !mentionsFeedbackStyleHelp(q)
  ) {
    return "draft_rewrite";
  }

  if (
    (includesAny(q, sentenceGenerationPatterns) ||
      (/(write|continue|generate|make|give)/.test(q) &&
        /(sentence|paragraph|essay|answer|continuation|next part)/.test(q))) &&
    !continuationSupport &&
    !mentionsPlanningHelp(q)
  ) {
    return "sentence_generation";
  }

  if (includesAny(q, outsideContentPatterns)) {
    return "outside_content";
  }

  return null;
}

export function classifyQuery(query: string): QueryType {
  return detectRestrictionReason(query) ? "restricted" : "allowed";
}
