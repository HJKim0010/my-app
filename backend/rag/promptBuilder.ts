import type { TaskPackage } from "@/backend/rag/loader";
import type { ConversationMemory } from "@/backend/rag/conversationMemory";
import type { RetrievedChunk } from "@/backend/rag/retriever";

export type SupportMode = "comprehension" | "ideas" | "organization" | "language";
export type ResponseLanguage = "korean" | "english";

const SENTENCE_SUPPORT_TERMS = [
  "in english",
  "in korean",
  "translate",
  "translation",
  "how do i say",
  "how can i say",
  "say it in english",
  "pattern",
  "structure",
  "frame",
  "clause",
  "sentence structure",
  "영어로",
  "한국어로",
  "번역",
  "문장 구조",
  "문장 틀",
  "구조",
  "표현하면",
];

const IDEA_TERMS = [
  "idea",
  "ideas",
  "brainstorm",
  "what could happen next",
  "next idea",
  "next event",
  "possible",
  "direction",
  "ending",
  "반전",
  "아이디어",
  "다음 사건",
  "다음 아이디어",
  "전개 방향",
];

const ORGANIZATION_TERMS = [
  "outline",
  "structure",
  "organize",
  "organization",
  "paragraph order",
  "flow",
  "beginning middle end",
  "plot",
  "구성",
  "전개",
  "개요",
  "문단 순서",
  "흐름",
];

const LANGUAGE_TERMS = [
  "word",
  "words",
  "expression",
  "vocabulary",
  "grammar",
  "tense",
  "natural",
  "more natural",
  "phrase",
  "단어",
  "표현",
  "어휘",
  "문법",
  "시제",
  "자연스럽",
];

export function prefersKorean(text: string): boolean {
  return /[\uac00-\ud7a3]/.test(text);
}

function prefersEnglish(text: string): boolean {
  return /[a-z]/i.test(text) && !prefersKorean(text);
}

export function detectResponseLanguage(query: string): ResponseLanguage {
  const normalized = query.toLowerCase();

  const wantsEnglish = [
    "in english",
    "english please",
    "answer in english",
    "say it in english",
    "영어로",
    "영어로 답",
    "영어로 설명",
  ].some((term) => normalized.includes(term));

  if (wantsEnglish) {
    return "english";
  }

  const wantsKorean = [
    "in korean",
    "korean please",
    "answer in korean",
    "한국어로",
    "한글로",
    "한국어로 답",
    "한글로 답",
    "한국어로 설명",
    "한글로 설명",
  ].some((term) => normalized.includes(term));

  if (wantsKorean) {
    return "korean";
  }

  return prefersEnglish(query) ? "english" : "korean";
}

export function detectSupportMode(query: string, category?: string): SupportMode {
  const normalized = query.toLowerCase();
  const loweredCategory = category?.toLowerCase() || "";

  if (detectSentenceLevelSupport(query)) {
    return "language";
  }

  if (
    IDEA_TERMS.some((term) => normalized.includes(term.toLowerCase())) ||
    loweredCategory.includes("idea")
  ) {
    return "ideas";
  }

  if (
    ORGANIZATION_TERMS.some((term) => normalized.includes(term.toLowerCase())) ||
    loweredCategory.includes("organization") ||
    loweredCategory.includes("planning")
  ) {
    return "organization";
  }

  if (
    LANGUAGE_TERMS.some((term) => normalized.includes(term.toLowerCase())) ||
    loweredCategory.includes("language") ||
    loweredCategory.includes("vocabulary")
  ) {
    return "language";
  }

  return "comprehension";
}

export function detectSentenceLevelSupport(query: string): boolean {
  const normalized = query.toLowerCase();
  return SENTENCE_SUPPORT_TERMS.some((term) => normalized.includes(term.toLowerCase()));
}

export function buildSystemInstruction(language: ResponseLanguage): string {
  return [
    "You are My Writing Assistant, a supportive and source-grounded chatbot for integrated writing.",
    "You are a helper and thinking partner, not a scorer, rater, evaluator, or judge.",
    "Your role is balanced across both task1 and task2.",
    "You only support four kinds of help:",
    "1) comprehension of the given multimodal source,",
    "2) idea generation within the source,",
    "3) organization and development planning,",
    "4) lexical and expression-level language support.",
    "Use AI to think, not to write.",
    "Do not assign scores, levels, or band labels.",
    "Do not write ready-to-submit sentences, paragraphs, or full answers for the learner.",
    "Do not summarize the whole story or whole source.",
    "Do not correct, rewrite, score, or evaluate the learner's draft.",
    "Do not introduce outside knowledge, outside examples, or outside content beyond the provided task materials.",
    "For comprehension questions, explain only the relevant part of the provided materials.",
    "For idea questions, give 2 or 3 short possibilities, not a finished continuation.",
    "For organization questions, give a short structure, sequence, or planning frame.",
    "For language questions, give short word, expression, or grammar help only.",
    "For sentence-level language support, prefer a short pattern or key structure first.",
    "You may give one short example sentence only when it serves as language illustration, not as continuation writing.",
    "Do not give multiple connected sentences or a polished paragraph as language help.",
    "Answer in 3 to 5 short bullet points by default.",
    "Keep the whole answer within 5 short sentences or bullet lines.",
    "When possible, answer in this order: direct answer, short reason, and one helpful next step.",
    "Prefer fact plus reason plus implication, not isolated fact recall.",
    "Keep responses concise, practical, and supportive.",
    "Use plain text only.",
    language === "english"
      ? "Answer in English for this turn. Only switch languages if the user explicitly asks you to."
      : "Answer mainly in Korean for this turn. Add short English words or phrases only when useful for learning.",
    "If the retrieved materials are not enough to answer safely, say so briefly and ask the user to specify one scene, object, action, or line.",
  ].join("\n");
}

function buildModeInstruction(mode: SupportMode): string {
  if (mode === "ideas") {
    return [
      "Support mode: idea generation.",
      "Give only short next-step possibilities or directions.",
      "Do not write the next paragraph or a finished continuation.",
    ].join("\n");
  }

  if (mode === "organization") {
    return [
      "Support mode: organization and development planning.",
      "Give a short outline, sequence, or paragraph-level plan.",
      "Do not draft the actual paragraph.",
    ].join("\n");
  }

  if (mode === "language") {
    return [
      "Support mode: lexical and expression-level language support.",
      "Focus on word choice, expressions, simple grammar, or nuance.",
      "Do not rewrite the learner's draft for them.",
    ].join("\n");
  }

  return [
    "Support mode: source comprehension.",
    "Answer only with the relevant scene, action, object, or meaning from the retrieved task materials.",
    "Go beyond isolated facts when the source supports it: explain the likely reason, feeling, or story implication briefly.",
    "Do not drift into whole-story summary.",
  ].join("\n");
}

function buildSentenceSupportInstruction(query: string): string {
  if (!detectSentenceLevelSupport(query)) {
    return "";
  }

  return [
    "Sentence-level support is appropriate for this request.",
    "Treat this as language coaching, not answer generation.",
    "Prefer this order: short pattern, one short example sentence if needed, then one small variation or learner option.",
    "If the user gives one short Korean or English idea, you may help express it in one short sentence.",
    "Do not turn it into multiple connected story sentences.",
  ].join("\n");
}

export function buildUserInput(
  query: string,
  category: string,
  taskPackage: TaskPackage,
  retrievedChunks: RetrievedChunk[],
  mode: SupportMode,
  language: ResponseLanguage,
  memory?: ConversationMemory
): string {
  const chunksText =
    retrievedChunks.length === 0
      ? "(No retrieved chunks)"
      : retrievedChunks
          .map(
            (chunk, index) =>
              `[Chunk ${index + 1}] ${chunk.sourceLabel}\n${chunk.content.trim()}`
          )
          .join("\n\n");

  return [
    `Task ID: ${taskPackage.taskId}`,
    `Category: ${category}`,
    `Support mode: ${mode}`,
    `Response language: ${language}`,
    "",
    buildModeInstruction(mode),
    buildSentenceSupportInstruction(query),
    "",
    "Task prompt:",
    taskPackage.prompt || "(No task prompt)",
    "",
    "Task instruction:",
    taskPackage.instruction || "(No task instruction)",
    "",
    "Recent conversation memory:",
    memory?.recentSummary || "(No recent conversation memory)",
    "",
    "Active conversation focus:",
    `Last user focus: ${memory?.lastUserFocus || "(Unknown)"}`,
    `Active entities: ${memory?.activeEntities.join(", ") || "(None)"}`,
    `Active scene: ${memory?.activeScene || "(Unknown)"}`,
    "",
    "Retrieved task materials:",
    chunksText,
    "",
    "User question:",
    query,
    "",
    "Answer only within the current task materials and the allowed support role.",
  ].join("\n");
}
