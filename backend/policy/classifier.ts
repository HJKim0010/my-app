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
];

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
];

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
  "정리해줘",
  "요약",
  "줄거리",
];

const outsideContentPatterns = [
  "add new background",
  "give outside ideas",
  "use outside knowledge",
  "based on real life",
  "what usually happens in real life",
  "what would people normally do",
  "cultural background",
  "extra background knowledge",
];

function includesAny(query: string, patterns: string[]): boolean {
  return patterns.some((pattern) => query.includes(pattern));
}

export function detectRestrictionReason(query: string): RestrictionReason | null {
  const q = query.toLowerCase();

  if (
    includesAny(q, wholeSourceSummaryPatterns) ||
    (/story|source|text|video|audio/.test(q) &&
      /summar|summary|overall|main idea|gist|정리|요약|줄거리/.test(q))
  ) {
    return "whole_source_summary";
  }

  if (
    includesAny(q, draftFeedbackPatterns) ||
    (/my draft|my writing|this sentence|this paragraph/.test(q) &&
      /fix|correct|improve|rewrite|edit|check|evaluate|grade|score/.test(q))
  ) {
    return "draft_feedback";
  }

  if (
    includesAny(q, sentenceGenerationPatterns) ||
    (/write|continue|generate|make|give/.test(q) &&
      /sentence|paragraph|essay|answer|continuation|next part/.test(q))
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
