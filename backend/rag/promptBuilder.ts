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
  "영어로",
  "한국어로",
  "번역",
  "표현",
  "단어",
  "어휘",
  "문장 구조",
  "패턴",
  "문장 틀",
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
  "clue",
  "hint",
  "use the clue",
  "given clue",
  "problem solving",
  "solve the problem",
  "story makes sense",
  "아이디어",
  "다음 사건",
  "다음 전개",
  "가능한 전개",
  "단서",
  "힌트",
  "이어지",
  "문제 해결",
  "자연스러운 전개",
  "내 아이디어",
  "내가 만든 이야기",
  "내가 쓴 전개",
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
  "think before acting",
  "thought before acting",
  "before acting",
  "cause and effect",
  "구성",
  "구조",
  "흐름",
  "순서",
  "정리",
  "처음",
  "중간",
  "끝",
  "원인",
  "결과",
  "이유",
  "행동 전에",
  "생각하고",
  "자연스러운 흐름",
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
  "my writing",
  "my draft",
  "what i wrote",
  "문법",
  "어색",
  "논리",
  "자연",
  "피드백",
  "확인",
  "괜찮",
  "내 글",
  "내 작문",
  "내 라이팅",
  "내 초안",
  "내가 쓴 글",
  "내 문장",
  "흐름 괜찮",
  "말이 돼",
] as const;

const USER_CONTINUATION_TERMS = [
  "my continuation",
  "my idea",
  "based on what i wrote",
  "based on my idea",
  "stop talking about the source",
  "continuation writing",
  "writing task",
  "my writing",
  "my draft",
  "what i wrote",
  "내가 만든 이야기",
  "내가 만든 내용",
  "내가 쓴 전개",
  "내가 쓴 글",
  "내 글",
  "내 작문",
  "내 라이팅",
  "내 초안",
  "내 아이디어",
  "자료 말고",
  "원문 말고",
  "내가 원하는 전개",
  "그냥 내 전개",
  "이어쓰기",
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
  "글쓰기 과제",
  "다음 전개",
  "다음 장면",
  "다음 사건",
  "끝부분",
  "결말",
  "단서",
  "힌트",
  "단서 사용",
  "행동 전에",
  "생각하고",
  "자연스러운 흐름",
  "문제 해결",
  "말이 돼",
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

  if (memory?.activeSupportContext && memory.isContextualFollowUp) {
    if (memory.activeSupportContext === "sentence_translation") {
      return "language";
    }

    return memory.activeSupportContext;
  }

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
    "You help learners think, understand, plan, and revise locally without writing the final answer for them.",
    "You may support six goals: story or material comprehension, idea development, organization, local language help, limited diagnostic feedback, and soft redirection from prohibited full-writing requests.",
    "Help only as much as the learner asks. Do not push the learner toward the next task step unless they ask for guidance, seem stuck, or choose that direction.",
    "Answer the learner's actual question first; do not start by explaining the whole story, source, or task unless the learner asks for that.",
    "Treat the recent conversation memory as part of the current user question. Resolve short follow-ups, pronouns, and phrases like 'that one', 'the previous one', '그거', '아까 말한 것', '좀 더', and '다시' from the recent conversation before answering.",
    "If the learner asks for 'more', 'another way', or 'again', continue from the immediately previous assistant answer instead of restarting the task explanation.",
    "If the learner greets you or asks vaguely for help, respond calmly and ask what specific part they want help with before using story details.",
    "When the request is ambiguous, do not assume the learner's intent. Ask one short clarifying question, or offer 2 or 3 possible meanings and let the learner choose.",
    "Use writing support when the learner asks for writing support. If the learner asks only for comprehension, expression, or a simple restatement, stay within that request.",
    "For continuation writing, help with clues, character reactions, decisions, cause-and-effect, and story flow only when relevant to the learner's request.",
    "When using source information, connect it to the learner's request without forcing a writing move every time.",
    "A short recap is allowed when it helps the learner recover the context, but do not turn every answer into task coaching.",
    "New events are allowed when they logically connect to the story situation, character, conflict, mood, or unresolved clue.",
    "Do not reject an idea only because it is new.",
    "Do not write the whole continuation, a full paragraph, a model answer, or a polished full rewrite.",
    "When a request is not allowed, redirect positively: briefly name the safer kind of help you can provide instead of sounding punitive or scolding.",
    "Use supportive language such as 'instead, I can help you...' and keep the learner's agency clear.",
    "If the learner asks how to say a short word or phrase in English, you may give local expression options.",
    "If the learner asks to translate a whole Korean sentence into English, do not provide a complete translated sentence. Instead, give key words, a sentence frame with blanks, and a short note so the learner can assemble it.",
    "Do not turn Korean-to-English help into a full answer, model sentence, full paragraph, or polished continuation.",
    "If the learner asks how to express a Korean phrase more naturally, include natural English options unless they clearly ask for Korean-only phrasing.",
    "Do not provide a final score, band, or rubric judgment.",
    "If the learner asks for feedback, give limited diagnostic feedback instead of refusing.",
    "Allowed feedback: logic issues, story-connection issues, awkward expressions, grammar problems, and phrase-level or sentence-level revision options.",
    "Not allowed feedback: whole-draft rewriting or full continuation generation.",
    "When the learner sounds frustrated, slow down, acknowledge briefly, and answer only the part they are asking about.",
    "If the learner sends a very short confused reaction such as '??', '뭐라고?', or '다시', treat it as a request to restate your immediately previous point more simply.",
    "If the previous point is clear, restate it in easier language. If it is not clear what they mean, ask a short clarification question instead of guessing.",
    continuationInstruction,
    mode === "ideas"
      ? "For idea development, answer the specific idea question. Give fit/naturalness feedback and possible next events only when the learner asks for ideas or seems stuck."
      : mode === "organization"
        ? "For organization, give only the amount of structure requested. A short sequence is enough unless the learner asks for a fuller plan."
        : mode === "language"
          ? "For local language support, help with words, phrases, grammar, and sentence frames. Avoid translating a whole Korean sentence into a complete English answer."
        : mode === "feedback"
            ? "For feedback, focus on what the learner asked to check. Mention only the most relevant flow, logic, or language issues."
            : "For comprehension, explain only the relevant story, reading, or video detail. Do not add a writing next step unless the learner asks for one.",
    "Keep the response concise and practical.",
    "Prefer 3 to 5 short bullet points or short lines.",
    "A slightly longer answer is allowed when needed to repair a confusing previous reply.",
    "Do not over-explain.",
    "Do not end every answer with an assignment-like next step. If a follow-up would help, phrase it softly, such as '필요하면...' or '원하면...'.",
    "Use plain text only.",
    responseLanguageInstruction,
  ].join("\n");
}

function buildModeInstruction(mode: SupportMode): string {
  if (mode === "ideas") {
    return [
      "Support mode: idea development.",
      "Respond to the idea question the learner actually asked.",
      "If they ask whether an idea works, briefly say why it fits or what feels unclear.",
      "Suggest next events only when the learner asks for ideas or seems stuck.",
      "Do not draft a full continuation paragraph.",
    ].join("\n");
  }

  if (mode === "organization") {
    return [
      "Support mode: organization and planning.",
      "Give a short structure only for the part the learner asks about.",
      "Mention clue, thought, action, consequence, or resolution only when relevant.",
      "Do not pressure the learner to complete the whole plan in this turn.",
      "Do not draft the actual paragraph.",
    ].join("\n");
  }

  if (mode === "language") {
    return [
      "Support mode: local language support.",
      "Focus on local word choice, grammar, expressions, or sentence patterns.",
      "For Korean-to-English sentence requests, do not give a complete translated sentence.",
      "Instead give key vocabulary, a sentence frame with blanks, and 1 or 2 short phrase options.",
      "Keep examples short and local; do not turn them into a full continuation paragraph or final answer.",
    ].join("\n");
  }

  if (mode === "feedback") {
    return [
      "Support mode: limited diagnostic feedback.",
      "Point out only the most relevant local logic, grammar, or expression issues.",
      "Do not rewrite the whole draft or overwhelm the learner with too many corrections.",
      "Suggest phrase-level or sentence-level fixes only when useful.",
    ].join("\n");
  }

  return [
    "Support mode: story or material comprehension.",
    "Explain the story, reading, or video detail that is relevant to the learner's current question.",
    "If the learner asks for a recap, give a short recap and stop there unless they ask for writing help.",
    "Do not turn a comprehension answer into a writing task prompt.",
  ].join("\n");
}

function buildSentenceSupportInstruction(query: string): string {
  if (!detectSentenceLevelSupport(query)) {
    return "";
  }

  return [
    "Sentence-level support is appropriate for this request, but whole-sentence translation should be avoided.",
    "Prefer this order: key vocabulary, sentence frame with blanks, 1 or 2 short phrase options, then a short nuance or grammar note.",
    "If the learner asks for a more natural expression, help locally without giving a complete final sentence unless the user has already drafted an English sentence.",
    "Do not turn it into a full continuation paragraph or final answer.",
  ].join("\n");
}

function buildContextFollowUpInstruction(memory?: ConversationMemory): string {
  if (!memory?.activeSupportContext || !memory.isContextualFollowUp) {
    return "";
  }

  if (memory.activeSupportContext === "sentence_translation") {
    return [
      "The current user question is a short follow-up to the previous sentence-level language request.",
      "Continue the previous language-support context instead of switching to story clues or general story ideas.",
      "Use the previous Korean sentence as context, but do not provide a complete English translation.",
      "Give stronger help than a tiny hint: offer key words, a sentence frame with blanks, and short phrase options.",
      "Keep the help local; do not write a full continuation paragraph or final answer.",
    ].join("\n");
  }

  return [
    `The current user question is a short follow-up to the previous ${memory.activeSupportContext} support context.`,
    "Resolve pronouns, short words, and vague requests from the recent conversation before answering.",
    "Do not switch to a new topic just because the current message is short.",
    "If the follow-up can reasonably mean more than one thing, ask a brief clarification instead of guessing.",
    "Answer the follow-up within the previous task focus without adding an assignment-like next step.",
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
    `Active support context: ${memory?.activeSupportContext || "(None)"}`,
    `Contextual follow-up: ${memory?.isContextualFollowUp ? "yes" : "no"}`,
    "",
    buildModeInstruction(mode),
    buildSentenceSupportInstruction(query),
    buildContextFollowUpInstruction(memory),
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
