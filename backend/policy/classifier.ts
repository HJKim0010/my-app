export type QueryType = "allowed" | "restricted";

export type RestrictionReason =
  | "sentence_generation"
  | "draft_feedback"
  | "whole_source_summary"
  | "outside_content";

const sentenceGenerationPatterns = [
  "write the next",
  "write next",
  "continue the story",
  "continue this story",
  "finish the story",
  "give me a paragraph",
  "write a paragraph",
  "write the paragraph",
  "write a sentence",
  "give me a sentence",
  "make a sentence",
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
  "next part",
  "next paragraph",
  "next sentence",
  "write the continuation",
  "continue it for me",
  "make it for me",
  "write my answer",
  "give me a continuation",
  "write based on this",
  "write from this",
  "write using this",
  "다음 문단",
  "다음 문장",
  "이어 써",
  "이어써",
  "계속 써",
  "결말 써",
  "끝을 써",
  "답안을 써",
  "답안 써",
  "정답 써",
  "대신 써",
] as const;

const draftFeedbackPatterns = [
  "correct my draft",
  "fix my draft",
  "improve my draft",
  "rewrite my draft",
  "edit my draft",
  "check my draft",
  "evaluate my draft",
  "grade my draft",
  "score my draft",
  "is my draft good",
  "is this sentence okay",
  "is this paragraph okay",
  "check my writing",
  "fix my writing",
  "improve my writing",
  "rewrite this sentence",
  "rewrite this paragraph",
  "correct this sentence",
  "correct this paragraph",
  "고쳐 줘",
  "고쳐줘",
  "수정해 줘",
  "수정해줘",
  "첨삭",
  "교정",
  "문법 체크",
  "내 글",
  "내 문장",
  "내 문단",
] as const;

const wholeSourceSummaryPatterns = [
  "summarize",
  "summary",
  "sum up",
  "overview",
  "overall meaning",
  "main idea of the story",
  "what is this story about",
  "what's this story about",
  "tell me the whole story",
  "explain the whole story",
  "organize the whole story",
  "gist",
  "tell me what happened",
  "what happened in the story",
  "explain the story",
  "give me the content",
  "give me the summary",
  "summary of the story",
  "summary of the source",
  "summarize the text",
  "summarize the video",
  "summarize the audio",
  "요약",
  "정리",
  "줄거리",
  "전체 내용",
  "전체 이야기",
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
  "바깥 정보",
  "외부 정보",
  "배경지식",
  "실제로는",
] as const;

function includesAny(query: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => query.includes(pattern));
}

function isStructureCriteriaHelp(query: string): boolean {
  return (
    /(structure|organization|flow|criterion|criteria|checklist)/.test(query) ||
    /(\uAD6C\uC131|\uAD6C\uC870|\uD750\uB984|\uAE30\uC900|\uCCB4\uD06C\uB9AC\uC2A4\uD2B8)/.test(query)
  );
}

export function detectRestrictionReason(query: string): RestrictionReason | null {
  const q = query.toLowerCase();

  if (
    includesAny(q, wholeSourceSummaryPatterns) ||
    (/(story|source|text|video|audio|이야기|본문|글|영상)/.test(q) &&
      /(summar|summary|overall|main idea|gist|요약|정리|줄거리)/.test(q))
  ) {
    return "whole_source_summary";
  }

  if (
    includesAny(q, draftFeedbackPatterns) ||
    (/(my draft|my writing|this sentence|this paragraph|내 글|내 문장|내 문단)/.test(q) &&
      /(fix|correct|improve|rewrite|edit|check|evaluate|grade|score|고쳐|수정|교정|첨삭)/.test(
        q
      ))
  ) {
    if (isStructureCriteriaHelp(q)) {
      return null;
    }

    return "draft_feedback";
  }

  if (
    includesAny(q, sentenceGenerationPatterns) ||
    (/(write|continue|generate|make|give|써|작성)/.test(q) &&
      /(sentence|paragraph|essay|answer|continuation|next part|문장|문단|답안|결말)/.test(q))
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
