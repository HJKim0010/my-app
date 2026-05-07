import type { TaskPackage } from "@/backend/rag/loader";
import type { ConversationMemory } from "@/backend/rag/conversationMemory";
import type { RetrievedChunk } from "@/backend/rag/retriever";

export type SupportMode =
  | "comprehension"
  | "ideas"
  | "organization"
  | "language"
  | "feedback";
export type ResponseLanguage = "korean" | "english";

function episodeLabel(taskId: TaskPackage["taskId"]): string {
  return taskId === "task2" ? "EP2 / Anna's story" : "EP1 / Jack's story";
}

function materialLabel(taskPackage: TaskPackage): string {
  return taskPackage.condition === "dynamic" ? "video and scene materials" : "reading and story materials";
}

const SENTENCE_SUPPORT_TERMS = [
  "in english",
  "in korean",
  "translate",
  "translation",
  "how do i say",
  "how can i say",
  "say it in english",
  "pattern",
  "frame",
  "sentence structure",
  "word",
  "expression",
  "vocabulary",
  "grammar",
  "phrase",
] as const;

const IDEA_TERMS = [
  "idea",
  "ideas",
  "brainstorm",
  "what could happen next",
  "what happens next",
  "next idea",
  "next event",
  "possible continuation",
  "possible next",
  "what comes next",
  "my continuation",
  "my idea",
  "내가 만든 이야기",
  "내가 만든 내용",
  "내가 짠 전개",
  "다음 전개",
  "가능한 전개",
  "뒷이야기",
  "이어지",
  "clue",
  "hint",
  "use the clue",
  "given clue",
  "problem solving",
  "solve the problem",
  "story makes sense",
  "단서",
  "힌트",
  "문제 해결",
  "해결",
  "자연스러운 전개",
] as const;

const ORGANIZATION_TERMS = [
  "outline",
  "structure",
  "organize",
  "organization",
  "paragraph order",
  "flow",
  "beginning middle end",
  "plot",
  "sequence",
  "scene order",
  "구성",
  "흐름",
  "순서",
  "플롯",
  "think before acting",
  "thought before acting",
  "before acting",
  "cause and effect",
  "자연스러운 흐름",
  "행동 전에",
  "생각하고",
  "이유가",
  "원인",
  "결과",
] as const;

const FEEDBACK_TERMS = [
  "is this logical",
  "does this make sense",
  "check my grammar",
  "grammar check",
  "is this okay",
  "is my text good",
  "feedback",
  "diagnostic",
  "check this flow",
  "check the logic",
  "문법",
  "어색",
  "자연스러",
  "논리",
  "말이 돼",
  "흐름 괜찮",
  "피드백",
] as const;

const USER_CONTINUATION_TERMS = [
  "내가 만든 이야기",
  "이건 내가 상상한",
  "내가 짠 전개",
  "다음에 가능한 전개",
  "이 아이디어 뒤에",
  "source 말고",
  "자료 얘기 그만해",
  "이건 요약이 아니야",
  "내가 만든 내용",
  "그냥 내 전개 봐줘",
  "my continuation",
  "based on what i wrote",
  "based on my idea",
  "stop talking about the source",
  "continuation writing",
  "writing task",
  "이어쓰기",
  "쓰기 과제",
  "글쓰기 과제",
  "전개를 도와",
  "어떻게 이어",
] as const;

const CONTINUATION_WRITING_TASK_TERMS = [
  "continuation writing",
  "writing task",
  "continue this story",
  "continue the story",
  "what should happen next",
  "what could happen next",
  "next part",
  "next event",
  "next scene",
  "ending",
  "clue",
  "hint",
  "use the clue",
  "given clue",
  "think before acting",
  "thought before acting",
  "story makes sense",
  "natural flow",
  "problem solving",
  "resolve the problem",
  "이어쓰기",
  "쓰기 과제",
  "글쓰기 과제",
  "다음 전개",
  "다음 장면",
  "뒷이야기",
  "결말",
  "단서",
  "힌트",
  "단서 활용",
  "행동 전에",
  "생각하고",
  "자연스러운 흐름",
  "문제 해결",
  "말이 되",
] as const;

function detectContinuationWritingTask(query: string, category?: string): boolean {
  const normalized = query.toLowerCase();
  const loweredCategory = category?.toLowerCase() || "";

  return (
    loweredCategory.includes("idea") ||
    loweredCategory.includes("organization") ||
    loweredCategory.includes("planning") ||
    CONTINUATION_WRITING_TASK_TERMS.some((term) => normalized.includes(term.toLowerCase()))
  );
}

export function prefersKorean(text: string): boolean {
  return /[\uac00-\ud7a3]/.test(text);
}

function prefersEnglish(text: string): boolean {
  return /[a-z]/i.test(text) && !prefersKorean(text);
}

export function detectResponseLanguage(query: string): ResponseLanguage {
  const normalized = query.toLowerCase();

  if (
    ["in english", "english please", "answer in english", "say it in english"].some((term) =>
      normalized.includes(term)
    )
  ) {
    return "english";
  }

  if (
    ["in korean", "korean please", "answer in korean"].some((term) =>
      normalized.includes(term)
    )
  ) {
    return "korean";
  }

  return prefersEnglish(query) ? "english" : "korean";
}

export function detectSentenceLevelSupport(query: string): boolean {
  const normalized = query.toLowerCase();
  return SENTENCE_SUPPORT_TERMS.some((term) => normalized.includes(term));
}

export function detectUserContinuationMode(query: string, memory?: ConversationMemory): boolean {
  const normalized = query.toLowerCase();

  if (USER_CONTINUATION_TERMS.some((term) => normalized.includes(term.toLowerCase()))) {
    return true;
  }

  if (memory?.workingContext === "user_continuation") {
    return true;
  }

  return false;
}

export function detectSupportMode(
  query: string,
  category?: string,
  memory?: ConversationMemory
): SupportMode {
  const normalized = query.toLowerCase();
  const loweredCategory = category?.toLowerCase() || "";
  const continuationMode = detectUserContinuationMode(query, memory);
  const writingTaskMode = detectContinuationWritingTask(query, category);

  if (
    FEEDBACK_TERMS.some((term) => normalized.includes(term.toLowerCase())) ||
    loweredCategory.includes("feedback") ||
    loweredCategory.includes("check")
  ) {
    return "feedback";
  }

  if (
    IDEA_TERMS.some((term) => normalized.includes(term.toLowerCase())) ||
    loweredCategory.includes("idea") ||
    (continuationMode && /(next|뒤|다음|이어|전개)/.test(normalized))
  ) {
    return "ideas";
  }

  if (
    ORGANIZATION_TERMS.some((term) => normalized.includes(term.toLowerCase())) ||
    loweredCategory.includes("organization") ||
    loweredCategory.includes("planning") ||
    (continuationMode && /(flow|structure|구성|흐름|순서)/.test(normalized))
  ) {
    return "organization";
  }

  if (detectSentenceLevelSupport(query) || loweredCategory.includes("language")) {
    return "language";
  }

  if (writingTaskMode) {
    return "organization";
  }

  return "comprehension";
}

export function buildSystemInstruction(
  language: ResponseLanguage,
  mode: SupportMode,
  continuationMode: boolean
): string {
  const responseLanguageInstruction =
    language === "english"
      ? "Answer in English for this turn. Only switch languages if the user explicitly asks you to."
      : "Answer mainly in Korean for this turn. Add short English words or phrases only when useful for learning.";

  const continuationInstruction = continuationMode
    ? [
        "User-continuation mode is active.",
        "Treat the learner's own continuation, draft, or idea as the main working context for this turn.",
        "Do not repeat the story recap unless the learner asks for it.",
        "Only mention the original story, reading, or video when the learner's new event clearly contradicts a key fact.",
      ].join("\n")
    : "Use the story, reading, or video briefly when it helps the learner's current writing goal.";

  return [
    "You are My Writing Assistant, a bounded writing support assistant for continuation writing.",
    "You help learners think, plan, and revise locally without writing the final answer for them.",
    "You may support six goals: story or material comprehension, idea development, organization, local language help, limited diagnostic feedback, and soft redirection from prohibited full-writing requests.",
    "Default to writing support whenever the learner is working on a continuation writing task; do not turn it into a comprehension quiz or a long source explanation.",
    "For continuation writing, help the learner make the next part use the given clue, show thinking before action, keep cause-and-effect clear, resolve or develop the problem naturally, and preserve a sensible story flow.",
    "When using source information, translate it into a writing move such as clue to use, character reaction, decision, action, consequence, or ending realization.",
    "A short recap is allowed when it helps the learner write faster or recover the context.",
    "New events are allowed when they logically connect to the story situation, character, conflict, mood, or unresolved clue.",
    "Do not reject an idea only because it is new.",
    "Do not write the whole continuation, a full paragraph, a model answer, or a polished full rewrite.",
    "If the learner asks you to translate a Korean sentence into English, do not give a complete direct translation.",
    "For sentence translation requests, redirect to a reusable pattern with blanks, 1 to 3 key vocabulary options, and a short prompt for the learner to try the sentence.",
    "Word-level translation is allowed, but sentence-level translation must stay pattern-based.",
    "Do not provide a final score, band, or rubric judgment.",
    "If the learner asks for feedback, give limited diagnostic feedback instead of refusing.",
    "Allowed feedback: logic issues, story-connection issues, awkward expressions, grammar problems, and phrase-level or sentence-level revision options.",
    "Not allowed feedback: whole-draft rewriting or full continuation generation.",
    "When the learner sounds frustrated, stop recapping the source and focus on the learner's current writing goal immediately.",
    "If the learner sends a very short confused reaction such as '응?', '뭐라고', or '다시', treat it as a request to restate your immediately previous point more simply.",
    "In that case, do not begin by saying you do not understand. Restate the key point in easier language, then give one small next-step option.",
    continuationInstruction,
    mode === "ideas"
      ? "For idea development, say whether the idea works, why it fits or not, how to make it more natural, and 2 or 3 possible next events that use clues and cause-effect."
      : mode === "organization"
        ? "For organization, give a short scene sequence or beginning-middle-end plan built around clue, thought, action, consequence, and resolution."
        : mode === "language"
          ? "For local language support, give the expression, a short explanation, and 1 or 2 short sentence patterns. Do not directly translate a full Korean sentence into a ready-to-use English sentence."
          : mode === "feedback"
            ? "For feedback, use this order when possible: overall flow, logic, language issues, local fixes, and next revision target."
            : "For comprehension, explain only the relevant story, reading, or video detail that helps the learner continue writing. If the learner asks for a recap, give a short recap and then connect it to the next writing step.",
    "Keep the response concise and practical.",
    "Prefer 3 to 5 short bullet points or short lines.",
    "A slightly longer answer is allowed when needed to repair a confusing previous reply.",
    "Do not over-explain.",
    "Use plain text only.",
    responseLanguageInstruction,
  ].join("\n");
}

function buildModeInstruction(mode: SupportMode): string {
  if (mode === "ideas") {
    return [
      "Support mode: idea development.",
      "Judge whether the learner's idea is workable, explain why, and suggest 2 or 3 possible next events.",
      "Prefer next events that use a given clue, give the character a reason to act, and move toward a natural problem-solving flow.",
      "Do not draft a full continuation paragraph.",
    ].join("\n");
  }

  if (mode === "organization") {
    return [
      "Support mode: organization and planning.",
      "Give a short sequence such as reaction, decision, consequence, and ending/realization.",
      "Check that the plan uses the clue, includes thinking before action, and makes the story outcome sensible.",
      "Do not draft the actual paragraph.",
    ].join("\n");
  }

  if (mode === "language") {
    return [
      "Support mode: local language support.",
      "Focus on local word choice, grammar, expressions, or sentence patterns.",
      "Keep examples short and local.",
    ].join("\n");
  }

  if (mode === "feedback") {
    return [
      "Support mode: limited diagnostic feedback.",
      "Point out local logic, grammar, or expression issues without rewriting the whole draft.",
      "Suggest phrase-level or sentence-level fixes only.",
    ].join("\n");
  }

  return [
    "Support mode: story or material comprehension.",
    "Explain the story, reading, or video detail that is relevant to the learner's current question.",
    "If the learner asks for a recap, give a short recap and then move back to writing support.",
    "End with one writing-focused next step when possible.",
  ].join("\n");
}

function buildSentenceSupportInstruction(query: string): string {
  if (!detectSentenceLevelSupport(query)) {
    return "";
  }

  return [
    "Sentence-level support is appropriate for this request.",
    "Prefer this order: expression or pattern, one short example, then one small variation.",
    "Do not turn it into a full continuation paragraph.",
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
    `Episode: ${episodeLabel(taskPackage.taskId)}`,
    `Category: ${category}`,
    `Support mode: ${mode}`,
    `Response language: ${language}`,
    `Working context: ${memory?.workingContext || "source"}`,
    "",
    buildModeInstruction(mode),
    buildSentenceSupportInstruction(query),
    "",
    "Story / task prompt:",
    taskPackage.prompt || "(No task prompt)",
    "",
    "Story / task instruction:",
    taskPackage.instruction || "(No task instruction)",
    "",
    "Recent conversation memory:",
    memory?.recentSummary || "(No recent conversation memory)",
    "",
    "Active conversation focus:",
    `Last user focus: ${memory?.lastUserFocus || "(Unknown)"}`,
    `Active entities: ${memory?.activeEntities.join(", ") || "(None)"}`,
    `Active scene: ${memory?.activeScene || "(Unknown)"}`,
    `Continuation focus: ${memory?.continuationFocus || "(None)"}`,
    "",
    `Retrieved ${materialLabel(taskPackage)}:`,
    chunksText,
    "",
    "User question:",
    query,
    "",
    "Answer within the bounded writing-support role.",
  ].join("\n");
}
