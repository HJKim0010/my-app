import { NextRequest } from "next/server";
import OpenAI from "openai";
import type { Response as OpenAIResponse } from "openai/resources/responses/responses";
import {
  analyzeQueryScope,
  type FeedbackTarget,
  type SupportModeLabel,
} from "@/backend/policy/classifier";
import { redirectResponse } from "@/backend/policy/redirect";
import { appendChatLog, type ChatLogEntry } from "@/backend/logs/logger";
import { resolveVisualInputs } from "@/backend/rag/assetResolver";
import {
  buildConversationMemory,
  type RecentMessage,
} from "@/backend/rag/conversationMemory";
import { loadTaskPackage, type TaskCondition, type TaskId } from "@/backend/rag/loader";
import {
  buildSystemInstruction,
  buildUserInput,
  detectResponseLanguage,
  detectSupportMode,
  type ResponseLanguage,
  type SupportMode,
} from "@/backend/rag/promptBuilder";
import { retrieveTaskChunks } from "@/backend/rag/retriever";

export const maxDuration = 60;

type QuickReply = {
  label: string;
  value?: string;
  action?: "send" | "prefill" | "focus";
};

type ChatApiResponse = {
  ok: boolean;
  requestId: string;
  status: "success" | "redirected" | "incomplete" | "timeout" | "error";
  text: string;
  reason: string | null;
  quickReplies: QuickReply[];
};

type AssistantDraftResponse = {
  text: string;
  quickReplies?: QuickReply[];
};

type ConversationOperation =
  | "new_request"
  | "translate_previous"
  | "simplify_previous"
  | "clarify_previous"
  | "none";

type RequestIntentClassification = {
  intent: string;
  request_is_explicit: boolean;
  requires_source_context: boolean;
  requires_task_context?: boolean;
  conversation_operation: ConversationOperation;
  confidence: number;
  selected_task_rule_id?: string | null;
  sub_requests?: Array<{
    text: string;
    requires_source_context: boolean;
    intent: string;
  }>;
};

type TaskRequirementRuleId =
  | "word_count"
  | "time_limit"
  | "permitted_tools"
  | "source_access"
  | "submission_rules";

type ChatStreamEvent =
  | {
      type: "start";
      requestId: string;
    }
  | {
      type: "delta";
      delta: string;
    }
  | {
      type: "done";
      payload: ChatApiResponse;
    }
  | {
      type: "error";
      payload: ChatApiResponse;
    };

function sanitizeAssistantResponse(text: string): string {
  return text
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const KOREAN_ACKNOWLEDGMENT_PATTERN =
  /^(?:\u3147\u3147|\u3147\u3147\??|\uc751|\uc751\??|\ub124|\ub137|\uc608|\uadf8\ub798|\uc88b\uc544|\uc88b\uc544\uc694|\uc54c\uaca0\uc5b4|\uc54c\uaca0\uc5b4\uc694|\uc624\ucf00\uc774|\uc624\ud0a4)$/i;
const PURE_SHORT_PUNCTUATION_PATTERN = /^[?!.~,/\\]+$/;

function isShortAcknowledgment(query: string): boolean {
  const normalized = compactText(query);
  return /^(yes|yeah|yep|ok|okay|sure|right|got it)$/i.test(normalized)
    || KOREAN_ACKNOWLEDGMENT_PATTERN.test(normalized);
}

function isAmbiguousShortReaction(query: string): boolean {
  const normalized = compactText(query);

  if (!normalized || normalized.length > 12) {
    return false;
  }

  return /^(what\?|huh\?|hm\?|hmm\?)$/i.test(normalized)
    || /^(뭐라고|뭐라고\?|무슨 뜻|헐|음|응\?|ㅇㅇ)[!?.~\s]*$/i.test(normalized)
    || PURE_SHORT_PUNCTUATION_PATTERN.test(normalized);
}

function isGreeting(query: string): boolean {
  const normalized = compactText(query).toLowerCase();

  if (!normalized || normalized.length > 40) {
    return false;
  }

  return /^(hi|hello|hey|good morning|good afternoon|good evening)[!?.~\s]*$/i.test(normalized)
    || /^(\uc548\ub155|\uc548\ub155\ud558\uc138\uc694|\ud558\uc774|\ud5ec\ub85c)[!?.~\s]*$/.test(normalized);
}

function containsGreeting(query: string): boolean {
  const normalized = compactText(query).toLowerCase();
  return /(?:^|\s)(hi|hello|hey|good morning|good afternoon|good evening)(?:[!?.~,\s]|$)/i.test(normalized)
    || /(?:^|\s)(\uc548\ub155|\uc548\ub155\ud558\uc138\uc694|\ud558\uc774|\ud5ec\ub85c)(?:[!?.~,\s]|$)/.test(normalized);
}

function isVagueHelpRequest(query: string): boolean {
  const normalized = compactText(query).toLowerCase();

  if (normalized.length > 80) {
    return false;
  }

  return /(help|help me|can you help|this part|which part|what part|\ub3c4\uc640\uc904|\ub3c4\uc640\uc8fc|\uc774\s*\ubd80\ubd84|\uc5b4\ub290\s*\ubd80\ubd84|\ubb50\ub97c\s*\ub3c4\uc640)/i.test(normalized);
}

function isMetaCapabilityQuestion(query: string): boolean {
  const normalized = compactText(query).toLowerCase();

  if (!normalized || normalized.length > 90) {
    return false;
  }

  return (
    /(can you understand|do you understand|understand me|understand what i say|will you understand|can you follow|can you keep up)/i.test(
      normalized
    ) ||
    /(내가\s*하는\s*말|내\s*말|제가\s*하는\s*말).*(이해|알아듣|알아\s*들|알겠)/.test(
      normalized
    ) ||
    /(잘\s*)?(이해할|알아들을)\s*수\s*있/.test(normalized)
  );
}

function hasExplicitAssistanceRequest(query: string): boolean {
  const normalized = compactText(query).toLowerCase();

  return /(can you|could you|would you|please|help(?: me)?|check|feedback|review|fix|correct|revise|rewrite|translate|explain|this sentence|my sentence|this phrase|my phrase|what does|what should|what would|what can|how can|how should|why does|why is|why did|why was|which part|which clue|idea|suggest|organize|outline|natural|awkward|make sense|word count|minimum length|maximum length|time limit|dictionary|submission|is this\s+(?:okay|ok|good|natural|logical|right|correct|clear|connected|related)|does this\s+(?:make sense|fit|connect|sound natural|work)|do you think|어때|어떻게|왜\s*(?:그런|이런|그렇게|이렇게|인가|일까|죠|요|해|했)|무슨\s*뜻|뭐가|뭐를|뭘|어느\s*부분|이대로|도와|봐\s*줘|봐줄|확인|피드백|검토|수정|고쳐|번역|설명|아이디어|제안|정리|구성|순서|자연스|어색|괜찮|맞아|맞나요|말이\s*되|문제|도움|몇\s*자|몇자|몇\s*단어|단어\s*수|글자\s*수|최소\s*몇|최대\s*몇|얼마나\s*(?:써야|길게)|분량|몇\s*개\s*이상|시간|몇\s*분|사전|원문\s*다시)/i.test(
    normalized
  );
}

function normalizeKoreanSpacing(text: string): string {
  return compactText(text)
    .replace(/몇\s+자/g, "몇자")
    .replace(/몇\s+단어/g, "몇단어")
    .replace(/단어\s+수/g, "단어수")
    .replace(/글자\s+수/g, "글자수")
    .replace(/최소\s+몇/g, "최소몇")
    .replace(/최대\s+몇/g, "최대몇")
    .replace(/몇\s+개\s+이상/g, "몇개이상");
}

function detectTaskRequirementRule(query: string): TaskRequirementRuleId | null {
  const normalized = normalizeKoreanSpacing(query).toLowerCase();

  if (/(몇자|몇단어|단어수|글자수|최소몇|최대몇|얼마나\s*(?:써야|길게)|분량|몇개이상|word count|minimum length|maximum length)/i.test(normalized)) {
    return "word_count";
  }

  if (/(시간|몇\s*분|제한\s*시간|time limit|writing time|how long)/i.test(normalized)) {
    return "time_limit";
  }

  if (/(사전|번역기|도구|사용해도|써도|dictionary|tool|permitted tools|allowed tools)/i.test(normalized)) {
    return "permitted_tools";
  }

  if (/(원문\s*다시|원문\s*볼|source\s*again|see the source|reread|read again)/i.test(normalized)) {
    return "source_access";
  }

  if (/(제출|저장|submit|submission|rule|rules|규칙|안내)/i.test(normalized)) {
    return "submission_rules";
  }

  return null;
}

function looksLikeDraftOrPassage(query: string): boolean {
  const trimmed = query.trim();
  const normalized = compactText(query);
  const lines = trimmed.split(/\n+/).filter((line) => line.trim().length > 0);
  const sentenceMarks = trimmed.match(/[.!?。！？]/g)?.length ?? 0;
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  const koreanChars = trimmed.match(/[\uac00-\ud7a3]/g)?.length ?? 0;

  return (
    lines.length >= 3 ||
    sentenceMarks >= 3 ||
    wordCount >= 45 ||
    (koreanChars >= 45 && normalized.length >= 80)
  );
}

function isDraftOnlyOrUnclearIntent(query: string): boolean {
  if (!looksLikeDraftOrPassage(query)) {
    return false;
  }

  const lines = query.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const lastExplicitIndex = lines.findLastIndex((line) => hasExplicitAssistanceRequest(line));

  if (lastExplicitIndex === -1) {
    return true;
  }

  return lastExplicitIndex < lines.length - 2;
}

function splitLearnerDraftAndRequest(query: string): { learnerDraft: string; currentRequest: string } {
  const lines = query.split(/\n+/);
  const requestStart = lines.findIndex((line) => hasExplicitAssistanceRequest(line));

  if (requestStart > 0) {
    return {
      learnerDraft: lines.slice(0, requestStart).join("\n").trim(),
      currentRequest: lines.slice(requestStart).join("\n").trim(),
    };
  }

  return {
    learnerDraft: looksLikeDraftOrPassage(query) ? query.trim() : "",
    currentRequest: query.trim(),
  };
}

function extractScopeLimitations(query: string): string[] {
  const normalized = compactText(query).toLowerCase();
  const limits: string[] = [];

  if (/(hint only|hints only|힌트만|도움말만)/i.test(normalized)) {
    limits.push("hints_only");
  }

  if (/(keyword only|keywords only|key words only|키워드만|단어만)/i.test(normalized)) {
    limits.push("keywords_only");
  }

  if (/(no full sentence|no full sentences|not a full sentence|complete sentence 말고|문장으로 쓰지|완전한 문장 말고|문장 전체 말고)/i.test(normalized)) {
    limits.push("no_full_sentences");
  }

  if (/(do not check grammar|don't check grammar|grammar 말고|문법은 보지|문법 체크 말고|문법 말고)/i.test(normalized)) {
    limits.push("no_grammar_check");
  }

  if (/(story connection only|source connection only|focus only on story connection|원래 이야기와 맞는지만|스토리 연결만|자료 연결만|연결만 봐)/i.test(normalized)) {
    limits.push("story_connection_only");
  }

  return [...new Set(limits)];
}

function splitSubRequests(query: string): string[] {
  const compact = query.trim();
  const parts = compact
    .split(/\n+|(?:\s+(?:and also|also|plus)\s+)|(?:그리고|또|추가로)/i)
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length > 1 ? parts : [compact];
}

function hasAmbiguousErroneousSentenceRequest(query: string): boolean {
  const normalized = compactText(query).toLowerCase();

  if (!looksLikeGeneralLanguageQuestion(query)) {
    return false;
  }

  return /(presentation disappeared|he is selected|jack decided on this problem|cold beer|he didn't care anna|memo was written|anna back to|get the folder|그가 선택되었다|발표가 사라졌|문제가 결정|신경 쓰지 않았다)/i.test(
    normalized
  );
}

function buildAmbiguousSentenceClarification(language: ResponseLanguage): string {
  return language === "english"
    ? "This sentence could mean more than one thing. What did you want to say?"
    : "이 문장은 뜻이 여러 가지로 해석될 수 있어요. 어떤 뜻으로 말하고 싶었나요?";
}

function looksLikeProceduralQuestion(query: string): boolean {
  const normalized = compactText(query).toLowerCase();

  return /(can i ask|how do i use|what can i ask|where should i|interface|button|한국어로 질문|영어로 질문|질문해도|어떻게 사용|사용 방법|절차|버튼|화면)/i.test(
    normalized
  );
}

function looksLikeGeneralLanguageQuestion(query: string): boolean {
  const normalized = compactText(query).toLowerCase();

  return /(natural|awkward|grammar|word|phrase|expression|vocabulary|sentence structure|pattern|in english|translate|translation|문장이 자연|자연스러|어색|문법|단어|표현|어휘|문장 구조|패턴|영어로|번역)/i.test(
    normalized
  );
}

function looksLikeSourceAlignmentRequest(query: string): boolean {
  const normalized = compactText(query).toLowerCase();

  return /(match|matches|fit|fits|connect|connected|consistent|contradict|missing connection|source connection|story connection|원래\s*이야기와\s*맞|자료와\s*맞|원문과\s*맞|연결|이어지|모순|빠진\s*연결|개연성|현실성)/i.test(
    normalized
  );
}

function looksLikeSourceContextRequest(query: string): boolean {
  const normalized = compactText(query).toLowerCase();
  const sourceReference =
    /(source|original story|story source|story material|reading|video|clue|event|character|relationship|scene|plot|원래\s*이야기|원문|자료|소스|읽기\s*자료|영상|단서|사건|장면|인물|관계|줄거리|스토리)/i.test(
      normalized
    );
  const sourceComprehension =
    /(what happened|what does|what did|who did|who was|where did|why did|why was|which clue|which event|explain the clue|explain this scene|무슨\s*뜻|무슨\s*일|누굴|누가|어디|왜\s*(?:그런|이런|그렇게|이렇게|인가|일까|죠|요|해|했)|어느\s*장면|어떤\s*단서|단서가\s*뭐|설명)/i.test(
      normalized
    );

  if (looksLikeSourceAlignmentRequest(query)) {
    return true;
  }

  if (sourceReference && (sourceComprehension || /explain|이해|설명|맞|연결|fit|match|connect/i.test(normalized))) {
    return true;
  }

  return false;
}

function classifyCurrentRequest(
  query: string,
  recentMessages: RecentMessage[],
  supportMode: SupportMode
): RequestIntentClassification {
  const { currentRequest } = splitLearnerDraftAndRequest(query);
  const classificationTarget = currentRequest || query;
  const taskRequirementRule = detectTaskRequirementRule(classificationTarget);

  if (taskRequirementRule) {
    return {
      intent: "task_requirement",
      request_is_explicit: true,
      requires_source_context: false,
      requires_task_context: true,
      conversation_operation: "new_request",
      confidence: 0.94,
      selected_task_rule_id: taskRequirementRule,
    };
  }

  if (isDraftOnlyOrUnclearIntent(query)) {
    return {
      intent: "draft_only",
      request_is_explicit: false,
      requires_source_context: false,
      conversation_operation: "none",
      confidence: 0.96,
    };
  }

  if (isLanguageChangeFollowUp(classificationTarget, recentMessages)) {
    const normalized = compactText(classificationTarget).toLowerCase();
    const operation: ConversationOperation = /(translate|in english|영어로|번역)/i.test(normalized)
      ? "translate_previous"
      : /(뭐라고|무슨 뜻|clarify|explain)/i.test(normalized)
        ? "clarify_previous"
        : "simplify_previous";

    return {
      intent: "language_change",
      request_is_explicit: true,
      requires_source_context: false,
      conversation_operation: operation,
      confidence: 0.92,
    };
  }

  if (!hasExplicitAssistanceRequest(classificationTarget) && looksLikeDraftOrPassage(query)) {
    return {
      intent: "unclear_intent",
      request_is_explicit: false,
      requires_source_context: false,
      conversation_operation: "none",
      confidence: 0.88,
    };
  }

  if (looksLikeProceduralQuestion(classificationTarget) || isMetaCapabilityQuestion(classificationTarget)) {
    return {
      intent: "procedural",
      request_is_explicit: true,
      requires_source_context: false,
      conversation_operation: "new_request",
      confidence: 0.86,
    };
  }

  const subRequests = splitSubRequests(classificationTarget).map((text) => ({
    text,
    requires_source_context: looksLikeSourceContextRequest(text),
    intent: looksLikeSourceAlignmentRequest(text)
      ? "source_alignment"
      : looksLikeSourceContextRequest(text)
        ? "source_comprehension"
        : looksLikeGeneralLanguageQuestion(text)
          ? "language_feedback"
          : "general_question",
  }));
  const sourceSubRequests = subRequests.filter((item) => item.requires_source_context);

  if (sourceSubRequests.length > 0) {
    return {
      intent: sourceSubRequests.some((item) => item.intent === "source_alignment")
        ? "source_alignment"
        : "source_comprehension",
      request_is_explicit: true,
      requires_source_context: true,
      conversation_operation: "new_request",
      confidence: 0.84,
      sub_requests: subRequests,
    };
  }

  if (looksLikeGeneralLanguageQuestion(classificationTarget) || supportMode === "language") {
    return {
      intent: supportMode === "feedback" ? "language_feedback" : "vocabulary_expression",
      request_is_explicit: hasExplicitAssistanceRequest(classificationTarget),
      requires_source_context: false,
      conversation_operation: "new_request",
      confidence: 0.78,
      sub_requests: subRequests,
    };
  }

  if (supportMode === "feedback") {
    return {
      intent: "language_feedback",
      request_is_explicit: hasExplicitAssistanceRequest(classificationTarget),
      requires_source_context: false,
      conversation_operation: "new_request",
      confidence: 0.72,
    };
  }

  if (supportMode === "ideas" || supportMode === "organization") {
    const sourceNeeded = looksLikeSourceContextRequest(classificationTarget);
    return {
      intent: supportMode === "ideas" ? "idea_generation" : "organization",
      request_is_explicit: hasExplicitAssistanceRequest(classificationTarget),
      requires_source_context: sourceNeeded,
      conversation_operation: "new_request",
      confidence: sourceNeeded ? 0.8 : 0.7,
    };
  }

  return {
    intent: hasExplicitAssistanceRequest(classificationTarget) ? "general_question" : "unclear_intent",
    request_is_explicit: hasExplicitAssistanceRequest(classificationTarget),
    requires_source_context: false,
    conversation_operation: hasExplicitAssistanceRequest(classificationTarget) ? "new_request" : "none",
    confidence: hasExplicitAssistanceRequest(classificationTarget) ? 0.62 : 0.45,
    sub_requests: subRequests,
  };
}

function intentLogFields(classification: RequestIntentClassification) {
  return {
    intent: classification.intent,
    request_is_explicit: classification.request_is_explicit,
    requires_source_context: classification.requires_source_context,
    requires_task_context: classification.requires_task_context || false,
    conversation_operation: classification.conversation_operation,
    classifier_confidence: classification.confidence,
    selected_task_rule_id: classification.selected_task_rule_id || null,
    sub_request_count: classification.sub_requests?.length || 1,
  };
}

function extractRetrievalQuery(query: string): string {
  const lines = query
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const sourceLines = lines.filter(
    (line) => hasExplicitAssistanceRequest(line) || looksLikeSourceContextRequest(line)
  );
  const selected = sourceLines.at(-1) || lines.at(-1) || query;

  return compactText(selected).slice(0, 500);
}

function buildDraftOnlyClarificationResponse(language: ResponseLanguage): string {
  return language === "english"
    ? "I’ve read your draft. What would you like help with?"
    : "작성한 내용을 확인했어요. 어떤 도움이 필요한지 알려주세요.";
}

function buildMissingContextResponse(ruleId: TaskRequirementRuleId, language: ResponseLanguage): string {
  const koreanMessages: Record<TaskRequirementRuleId, string> = {
    word_count:
      "정확한 최소 분량은 현재 정보만으로는 확인할 수 없어요. 과제 안내에 나온 word limit을 확인해 주세요.",
    time_limit:
      "현재 대화에는 정확한 제한 시간이 없어서 확인할 수 없어요. 과제 안내의 제한 시간을 확인해 주세요.",
    permitted_tools:
      "현재 정보만으로는 사전이나 도구 사용이 허용되는지 확인할 수 없어요. 과제 안내의 허용 도구 항목을 확인해 주세요.",
    source_access:
      "현재 대화만으로는 원문 재열람이 허용되는지 확인할 수 없어요. 과제 화면의 안내를 확인해 주세요.",
    submission_rules:
      "현재 정보만으로는 제출 규칙을 정확히 확인할 수 없어요. 과제 안내의 제출 방법을 확인해 주세요.",
  };
  const englishMessages: Record<TaskRequirementRuleId, string> = {
    word_count:
      "I cannot confirm the exact word limit from the current context. Please check the assignment word limit.",
    time_limit:
      "I cannot confirm the exact time limit from the current context. Please check the assignment instructions.",
    permitted_tools:
      "I cannot confirm whether dictionaries or tools are allowed from the current context. Please check the permitted-tools section.",
    source_access:
      "I cannot confirm from the current context whether you may view the source again. Please check the task screen or instructions.",
    submission_rules:
      "I cannot confirm the submission rules from the current context. Please check the assignment instructions.",
  };

  return language === "english" ? englishMessages[ruleId] : koreanMessages[ruleId];
}

function hasStructuredTaskRequirementAnswer(ruleId: TaskRequirementRuleId, instruction: string): boolean {
  return ruleId === "word_count" && /between\s+\d+\s+and\s+\d+\s+words/i.test(instruction);
}

function buildTaskRequirementResponse(
  ruleId: TaskRequirementRuleId,
  instruction: string,
  language: ResponseLanguage
): string {
  if (ruleId === "word_count") {
    const wordRange = instruction.match(/between\s+(\d+)\s+and\s+(\d+)\s+words/i);

    if (wordRange) {
      const [, minWords, maxWords] = wordRange;
      return language === "english"
        ? `It is based on English word count, not character count. Write between ${minWords} and ${maxWords} words.`
        : `글자 수가 아니라 영어 단어 수 기준이에요. 최소 ${minWords}단어, 최대 ${maxWords}단어로 작성하면 됩니다.`;
    }
  }

  return buildMissingContextResponse(ruleId, language);
}

function buildRecognizedQuestionMissingContextResponse(language: ResponseLanguage): string {
  return language === "english"
    ? "I understand the question, but I cannot confirm the exact information from the current context. Please check the assignment instructions or send the relevant detail."
    : "질문 의도는 이해했지만 현재 정보만으로 정확히 확인할 수 없어요. 과제 안내나 필요한 맥락을 조금 더 알려주세요.";
}

function getLatestAssistantText(recentMessages: RecentMessage[]): string {
  const latestAssistant = [...recentMessages]
    .reverse()
    .find((message) => message.role === "assistant" && message.text.trim().length > 0);

  return latestAssistant?.text.trim() || "";
}

function isLanguageChangeFollowUp(query: string, recentMessages: RecentMessage[]): boolean {
  const normalized = compactText(query).toLowerCase();

  if (!normalized || normalized.length > 100 || !getLatestAssistantText(recentMessages)) {
    return false;
  }

  const referencesPrevious =
    /(방금\s*답|방금|이거|이건|그거|그건|이\s*부분|그\s*부분|아까|previous answer|that part|that answer|it|that)/i.test(
      normalized
    );
  const asksToRestatePrevious =
    /(한국말|한국어|한글|korean|쉽게|더 쉽게|조금 쉽게|다시 설명|다시 말|풀어서|쉽게 설명|easier|simpler|more simply|explain that|explain it|say that again|rephrase)/i.test(
      normalized
    );
  const introducesNewTarget =
    /(이 장면|그 장면|이 문장|그 문장|단서|스토리|story|scene|sentence|clue|table\s*\d|anna|jack|wallet|presentation|subway|source|원문|자료)/i.test(
      normalized
    );

  return asksToRestatePrevious && (referencesPrevious || !introducesNewTarget);
}

function buildLanguageChangeInstructions(language: ResponseLanguage): string {
  const responseLanguageInstruction =
    language === "english"
      ? "Answer in English."
      : "Answer in Korean using simple, learner-friendly wording.";

  return [
    "You are My Writing Assistant.",
    "The user is asking for a language/style change of the immediately preceding assistant response.",
    "Use only the preceding assistant response and the current user request.",
    "Do not use source materials, story chunks, or outside facts.",
    "Do not introduce facts or examples that were absent from the preceding assistant response.",
    "Keep the same meaning, but make it easier, clearer, or in the requested language.",
    "If the preceding assistant response is empty or unclear, ask one brief clarification question.",
    "Do not evaluate, correct, summarize, or rewrite the user's draft unless the current request explicitly asks for that.",
    responseLanguageInstruction,
  ].join("\n");
}

function buildLanguageChangeInput(
  query: string,
  previousAssistantResponse: string,
  recentMessages: RecentMessage[]
): string {
  const recentHistory = recentMessages
    .slice(-6)
    .map((message) => `${message.role}: ${compactText(message.text)}`)
    .join("\n");

  return [
    "<RELEVANT_CHAT_HISTORY>",
    recentHistory || "(No recent conversation history)",
    "</RELEVANT_CHAT_HISTORY>",
    "",
    "<LEARNER_DRAFT>",
    "(No learner draft should be evaluated on this turn.)",
    "</LEARNER_DRAFT>",
    "",
    "<PREVIOUS_ASSISTANT_RESPONSE>",
    previousAssistantResponse,
    "</PREVIOUS_ASSISTANT_RESPONSE>",
    "",
    "<CURRENT_USER_REQUEST>",
    query,
    "</CURRENT_USER_REQUEST>",
  ].join("\n");
}

function shouldAskTargetClarification(
  query: string,
  mode: SupportMode,
  hasChunks: boolean,
  workingContext: "source" | "user_continuation"
): boolean {
  const normalized = compactText(query).toLowerCase();

  if (workingContext === "user_continuation") {
    return false;
  }

  if (hasChunks) {
    return false;
  }

  if (mode === "comprehension") {
    return normalized.length < 20;
  }

  return false;
}

function shouldAskForUserDraftBeforeSource(
  query: string,
  workingContext: "source" | "user_continuation"
): boolean {
  if (workingContext !== "user_continuation") {
    return false;
  }

  const normalized = compactText(query);
  if (normalized.length >= 80) {
    return false;
  }

  return /(내 글|내 작문|내 라이팅|내 초안|my writing|my draft|what i wrote)/i.test(normalized);
}

function emptyQuickReplies(payload: Partial<ChatApiResponse>): ChatApiResponse {
  return {
    ok: payload.ok ?? true,
    requestId: payload.requestId ?? crypto.randomUUID(),
    status: payload.status ?? "success",
    text: payload.text ?? "",
    reason: payload.reason ?? null,
    quickReplies: [],
  };
}

function chatJsonResponse(payload: Partial<ChatApiResponse>, status = 200): Response {
  const normalized = emptyQuickReplies(payload);
  return Response.json(normalized, { status });
}

function chatStreamResponse(
  stream: ReadableStream<Uint8Array>,
  status = 200
): Response {
  return new Response(stream, {
    status,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function encodeStreamEvent(event: ChatStreamEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

function participantErrorMessage(language: ResponseLanguage): string {
  return language === "english"
    ? "I could not make a reply just now. Please try once more."
    : "잠시 응답을 만들지 못했어요. 한 번만 다시 시도해 주세요.";
}

function mapSupportModeForLog(mode: SupportMode): SupportModeLabel {
  if (mode === "ideas") return "idea_generation";
  if (mode === "language") return "vocabulary_expression";
  if (mode === "feedback") return "feedback_checking";
  return mode;
}

function responseFromText(
  text: string,
  requestId: string,
  status: ChatApiResponse["status"] = "success",
  reason: string | null = null,
  quickReplies: QuickReply[] = []
): ChatApiResponse {
  void quickReplies;
  return { ok: status === "success" || status === "redirected", requestId, status, text, reason, quickReplies: [] };
}

function confirmationQuickReplies(_language: ResponseLanguage): QuickReply[] {
  void _language;
  return [];
}

function supportChoiceQuickReplies(_language: ResponseLanguage): QuickReply[] {
  void _language;
  return [];
}

function buildAmbiguousReactionResponseV2(language: ResponseLanguage): AssistantDraftResponse {
  if (language === "english") {
    return {
      text: "I am not fully sure what you mean yet. Did you mean my last answer was unclear?",
      quickReplies: confirmationQuickReplies(language),
    };
  }

  return {
    text: "아직 뜻을 정확히 잡기 어려워요. 방금 답변이 헷갈렸다는 뜻인가요?",
    quickReplies: confirmationQuickReplies(language),
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildGreetingResponseV2(language: ResponseLanguage): AssistantDraftResponse {
  if (language === "english") {
    return {
      text: "Hello. What would you like help with?",
      quickReplies: supportChoiceQuickReplies(language),
    };
  }

  return {
    text: "안녕하세요. 글쓰기에서 어떤 도움을 받고 싶나요?",
    quickReplies: supportChoiceQuickReplies(language),
  };
}

function buildGreetingClarificationResponse(language: ResponseLanguage): AssistantDraftResponse {
  if (language === "english") {
    return {
      text: "Hello. Which part would you like help with?",
    };
  }

  return {
    text: "안녕하세요. 어떤 부분을 도와드릴까요?",
  };
}

function buildCalmGreetingResponse(language: ResponseLanguage): AssistantDraftResponse {
  if (language === "english") {
    return {
      text: "Hello. What would you like help with?",
    };
  }

  return {
    text: "안녕하세요. 어떤 부분을 도와드릴까요?",
  };
}

function buildAcknowledgmentFollowUpV2(language: ResponseLanguage): AssistantDraftResponse {
  if (language === "english") {
    return {
      text: "I understand. What would you like next?",
      quickReplies: supportChoiceQuickReplies(language),
    };
  }

  return {
    text: "좋아요. 다음에는 어떤 도움을 받을까요?",
    quickReplies: supportChoiceQuickReplies(language),
  };
}

function buildMetaCapabilityResponse(language: ResponseLanguage): AssistantDraftResponse {
  if (language === "english") {
    return {
      text:
        "Yes, I can follow what you say. If something is unclear, I will ask a short question instead of guessing. You can ask in Korean, English, or both.",
    };
  }

  return {
    text:
      "네, 이해할 수 있어요. 다만 뜻이 애매하면 제가 넘겨짚지 않고 짧게 확인 질문을 할게요. 한국어, 영어, 섞어서 질문해도 괜찮아요.",
  };
}

function buildTargetClarificationResponseV2(
  language: ResponseLanguage,
  mode: SupportMode
): AssistantDraftResponse {
  if (language === "english") {
    if (mode === "comprehension") {
      return {
        text: "Which part should I explain first? Choose one or type the part yourself.",
        quickReplies: [
          { label: "Scene", value: "Please explain this scene: ", action: "prefill" },
          { label: "Object", value: "Please explain this object: ", action: "prefill" },
          { label: "I'll type", action: "focus" },
        ],
      };
    }

    return {
      text: "Please show me one short part of your idea or draft first, and I will help from there.",
      quickReplies: confirmationQuickReplies(language),
    };
  }

  if (mode === "comprehension") {
    return {
      text: "어느 부분을 설명하면 좋을까요? 장면, 행동, 물건, 문장 중 하나를 알려주세요.",
      quickReplies: [],
    };
  }

  return {
    text: "아이디어나 초안의 짧은 부분을 먼저 보여주세요. 그 부분부터 같이 살펴볼게요.",
    quickReplies: confirmationQuickReplies(language),
  };
}

function buildNoChunkResponseV2(
  mode: SupportMode,
  language: ResponseLanguage,
  workingContext: "source" | "user_continuation"
): AssistantDraftResponse {
  if (language === "english") {
    if (workingContext === "user_continuation") {
      return {
        text:
          mode === "feedback"
            ? "I need one short part of your continuation or draft to give feedback."
            : "I need one short part of your continuation idea first.",
        quickReplies: confirmationQuickReplies(language),
      };
    }

    return {
      text: "I need one clearer target first. Which part should we focus on?",
      quickReplies: [
        { label: "Scene", value: "Please help me with this scene: ", action: "prefill" },
        { label: "Clue", value: "Please help me with this clue: ", action: "prefill" },
        { label: "I'll type", action: "focus" },
      ],
    };
  }

  if (workingContext === "user_continuation") {
    return {
        text:
          mode === "feedback"
            ? "피드백을 하려면 이어쓰기 초안의 짧은 부분이 필요해요."
            : "먼저 이어쓰기 아이디어나 초안의 짧은 부분을 보여주세요.",
      quickReplies: confirmationQuickReplies(language),
    };
  }

  return {
    text: "먼저 어떤 부분을 보고 싶은지 알려주세요. 장면, 단서, 행동, 문장 중 하나를 골라도 좋아요.",
    quickReplies: [],
  };
}

async function persistChatLog(entry: ChatLogEntry): Promise<void> {
  await appendChatLog(entry).catch((error) => {
    console.error("Failed to persist chat log", error);
  });
}

function normalizeParticipantId(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().replace(/\s+/g, "-").toUpperCase();
}

function isValidParticipantId(value: string): boolean {
  return /^[A-Z0-9_-]{2,40}$/.test(value);
}

function toEpId(taskId: TaskId): "ep1" | "ep2" {
  return taskId === "task2" ? "ep2" : "ep1";
}

function buildCommonLogFields(params: {
  participantId: string;
  sessionId: string;
  epId: "ep1" | "ep2";
  taskId: TaskId;
  condition: TaskCondition;
  conditionLabel: string;
  category: string;
  query: string;
  policyDecision: string;
  policyReason: string | null;
  inputOrigin: "typed" | "quick_reply" | "prefill_edited";
  detectedSupportMode: string;
  feedbackTarget: FeedbackTarget;
  timestamp: string;
  interactionCount: number;
  sessionDurationMs: number;
}): Pick<
  ChatLogEntry,
  | "participant_id"
  | "session_id"
  | "ep_id"
  | "task_id"
  | "episode_id"
  | "condition_label"
  | "selected_category"
  | "raw_user_query"
  | "policy_decision"
  | "policy_reason"
  | "input_origin"
  | "source_condition"
  | "support_condition"
  | "detected_support_mode"
  | "user_query_type"
  | "feedback_target"
  | "timestamp"
  | "interaction_count"
  | "session_duration_ms"
  | "researcher_code"
> {
  return {
    participant_id: params.participantId,
    session_id: params.sessionId,
    ep_id: params.epId,
    task_id: params.taskId,
    episode_id: params.epId,
    condition_label: params.conditionLabel,
    selected_category: params.category,
    raw_user_query: params.query,
    policy_decision: params.policyDecision,
    policy_reason: params.policyReason,
    input_origin: params.inputOrigin,
    source_condition: params.condition,
    support_condition: "ai",
    detected_support_mode: params.detectedSupportMode,
    user_query_type: params.detectedSupportMode,
    feedback_target: params.feedbackTarget,
    timestamp: params.timestamp,
    interaction_count: params.interactionCount,
    session_duration_ms: params.sessionDurationMs,
    researcher_code: null,
  };
}

export async function POST(request: NextRequest) {
  let query = "";
  let category = "Others";
  let taskId: TaskId = "task1";
  let condition: TaskCondition = "static";
  let sessionId = "unknown-session";
  let participantId = "";
  let interactionCount = 1;
  let sessionStartedAt = Date.now();
  let recentMessages: RecentMessage[] = [];
  let inputOrigin: "typed" | "quick_reply" | "prefill_edited" = "typed";
  const requestId = crypto.randomUUID();

  try {
    const body = await request.json();
    query = typeof body?.query === "string" ? body.query : "";
    category = typeof body?.category === "string" ? body.category : category;
    taskId = body?.taskId === "task2" ? "task2" : "task1";
    condition = body?.condition === "dynamic" ? "dynamic" : "static";
    sessionId = typeof body?.sessionId === "string" ? body.sessionId : sessionId;
    participantId = normalizeParticipantId(body?.participantId);
    interactionCount =
      typeof body?.interactionCount === "number" ? body.interactionCount : interactionCount;
    sessionStartedAt =
      typeof body?.sessionStartedAt === "number" ? body.sessionStartedAt : sessionStartedAt;
    inputOrigin =
      body?.input_origin === "quick_reply" || body?.input_origin === "prefill_edited"
        ? body.input_origin
        : "typed";
    recentMessages = Array.isArray(body?.recentMessages)
      ? body.recentMessages.filter(
          (message: unknown): message is RecentMessage =>
            typeof message === "object" &&
            message !== null &&
            typeof (message as Record<string, unknown>).text === "string" &&
            (((message as Record<string, unknown>).role as string) === "user" ||
              ((message as Record<string, unknown>).role as string) === "assistant")
        )
      : [];
  } catch {
    query = "";
  }

  if (!query.trim()) {
    return chatJsonResponse(
      responseFromText("Please enter a prompt.", requestId, "error", "empty_query"),
      400
    );
  }

  if (!isValidParticipantId(participantId)) {
    return chatJsonResponse(
      responseFromText(
        "Participant ID is required before starting the chat.",
        requestId,
        "error",
        "invalid_participant_id"
      ),
      400
    );
  }

  const taskPackage = loadTaskPackage(taskId, condition);
  const epId = toEpId(taskId);
  const timestamp = new Date().toISOString();
  const sessionDurationMs = Math.max(0, Date.now() - sessionStartedAt);
  const policyAnalysis = analyzeQueryScope(query);
  const policyDecision = policyAnalysis.queryType;
  const restrictionReason = policyAnalysis.reason;
  const conversationMemory = buildConversationMemory(taskId, query, recentMessages);
  const supportMode = detectSupportMode(query, category, conversationMemory);
  const responseLanguage = detectResponseLanguage(query);
  const hasConversationContext = recentMessages.length > 0;
  const separatedTurn = splitLearnerDraftAndRequest(query);
  const scopeLimitations = extractScopeLimitations(query);
  const requestClassification = classifyCurrentRequest(query, recentMessages, supportMode);
  const commonLog = {
    ...buildCommonLogFields({
      participantId,
      sessionId,
      epId,
      taskId,
      condition,
      conditionLabel: taskPackage.config.ai_condition,
      category,
      query,
      policyDecision,
      policyReason: restrictionReason,
      inputOrigin,
      detectedSupportMode:
        policyAnalysis.detectedSupportMode === "other"
          ? mapSupportModeForLog(supportMode)
          : policyAnalysis.detectedSupportMode,
      feedbackTarget: policyAnalysis.feedbackTarget,
      timestamp,
      interactionCount,
      sessionDurationMs,
    }),
    ...intentLogFields(requestClassification),
    scope_limitations: scopeLimitations,
  };

  if (!requestClassification.request_is_explicit || requestClassification.confidence < 0.58) {
    const isGenuineDraftOnly = requestClassification.intent === "draft_only";
    const fallbackState = isGenuineDraftOnly
      ? "genuine_draft_only"
      : "recognized_question_missing_context";
    const responseText = isGenuineDraftOnly
      ? buildDraftOnlyClarificationResponse("korean")
      : buildRecognizedQuestionMissingContextResponse(responseLanguage);

    await persistChatLog({
      ...commonLog,
      participant_id: participantId,
      session_id: sessionId,
      ep_id: epId,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: "allowed",
      status: "allowed",
      response_status: "success",
      retrieved_chunk_ids: [],
      retrieved_chunk_metadata: [],
      assistant_response: responseText,
      timestamp,
      response_length: responseText.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: requestClassification.intent,
      detected_support_mode: requestClassification.intent,
      user_query_type:
        requestClassification.intent === "draft_only" ? "draft_only" : "unclear_intent",
      feedback_target: null,
      source_types_used: [],
      visual_assets_used: [],
      retrieval_executed: false,
      retrieval_skipped_reason: fallbackState,
      fallback_state: fallbackState,
    });

    return chatJsonResponse(responseFromText(responseText, requestId, "success", null));
  }

  if (requestClassification.intent === "task_requirement") {
    const ruleId = requestClassification.selected_task_rule_id || "submission_rules";
    const hasStructuredAnswer = hasStructuredTaskRequirementAnswer(
      ruleId as TaskRequirementRuleId,
      taskPackage.instruction
    );
    const responseText = buildTaskRequirementResponse(
      ruleId as TaskRequirementRuleId,
      taskPackage.instruction,
      responseLanguage
    );

    await persistChatLog({
      ...commonLog,
      participant_id: participantId,
      session_id: sessionId,
      ep_id: epId,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: "allowed",
      status: "allowed",
      response_status: "success",
      retrieved_chunk_ids: [],
      retrieved_chunk_metadata: [],
      assistant_response: responseText,
      timestamp,
      response_length: responseText.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: "procedural",
      detected_support_mode: "procedural",
      user_query_type: "procedural",
      feedback_target: null,
      source_types_used: [],
      visual_assets_used: [],
      retrieval_executed: false,
      retrieval_skipped_reason: "task_requirement",
      selected_task_rule_id: ruleId,
      fallback_state: hasStructuredAnswer ? null : "recognized_question_missing_context",
    });

    return chatJsonResponse(responseFromText(responseText, requestId, "success", null));
  }

  if (requestClassification.intent === "language_change") {
    const previousAssistantResponse = getLatestAssistantText(recentMessages);
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      const text = participantErrorMessage(responseLanguage);
      await persistChatLog({
        ...commonLog,
        participant_id: participantId,
        session_id: sessionId,
        ep_id: epId,
        condition_label: taskPackage.config.ai_condition,
        selected_category: category,
        raw_user_query: query,
        policy_decision: "allowed",
        status: "error",
        response_status: "error",
        retrieved_chunk_ids: [],
        retrieved_chunk_metadata: [],
        assistant_response: text,
        timestamp,
        response_length: text.length,
        interaction_count: interactionCount,
        session_duration_ms: sessionDurationMs,
        query_type_label: "language_change_followup",
        detected_support_mode: "language_change_followup",
        user_query_type: "vocabulary_expression",
        feedback_target: null,
        source_types_used: [],
        visual_assets_used: [],
        retrieval_executed: false,
        retrieval_skipped_reason: "language_change_followup",
        incomplete_reason: "missing_api_key",
      });

      return chatJsonResponse(responseFromText(text, requestId, "error", "service_unavailable"), 500);
    }

    const client = new OpenAI({ apiKey });
    const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
    const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 45000);
    const openAIController = new AbortController();
    const timeout = setTimeout(() => openAIController.abort(), timeoutMs);

    try {
      const response = await client.responses.create(
        {
          model,
          instructions: buildLanguageChangeInstructions(responseLanguage),
          max_output_tokens: Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 1200),
          input: [
            {
              role: "user" as const,
              content: [
                {
                  type: "input_text" as const,
                  text: buildLanguageChangeInput(
                    query,
                    previousAssistantResponse,
                    recentMessages
                  ),
                },
              ],
            },
          ],
        },
        { signal: openAIController.signal }
      );
      clearTimeout(timeout);

      const responseText = sanitizeAssistantResponse(response.output_text || "");
      const displayResponse = responseText || participantErrorMessage(responseLanguage);
      const responseStatus: ChatApiResponse["status"] = responseText ? "success" : "incomplete";

      await persistChatLog({
        ...commonLog,
        participant_id: participantId,
        session_id: sessionId,
        ep_id: epId,
        condition_label: taskPackage.config.ai_condition,
        selected_category: category,
        raw_user_query: query,
        policy_decision: "allowed",
        status: responseStatus,
        response_status: responseStatus,
        retrieved_chunk_ids: [],
        retrieved_chunk_metadata: [],
        assistant_response: displayResponse,
        timestamp,
        response_length: displayResponse.length,
        interaction_count: interactionCount,
        session_duration_ms: sessionDurationMs,
        query_type_label: "language_change_followup",
        detected_support_mode: "language_change_followup",
        user_query_type: "vocabulary_expression",
        feedback_target: null,
        source_types_used: [],
        visual_assets_used: [],
        retrieval_executed: false,
        retrieval_skipped_reason: "language_change_followup",
        incomplete_reason: responseText ? undefined : "empty_response",
      });

      return chatJsonResponse(
        responseFromText(
          displayResponse,
          requestId,
          responseStatus,
          responseStatus === "incomplete" ? "empty_response" : null
        )
      );
    } catch (error) {
      clearTimeout(timeout);
      const isTimeout = error instanceof Error && error.name === "AbortError";
      const text = participantErrorMessage(responseLanguage);

      await persistChatLog({
        ...commonLog,
        participant_id: participantId,
        session_id: sessionId,
        ep_id: epId,
        condition_label: taskPackage.config.ai_condition,
        selected_category: category,
        raw_user_query: query,
        policy_decision: "allowed",
        status: isTimeout ? "timeout" : "error",
        response_status: isTimeout ? "timeout" : "error",
        retrieved_chunk_ids: [],
        retrieved_chunk_metadata: [],
        assistant_response: text,
        timestamp,
        response_length: text.length,
        interaction_count: interactionCount,
        session_duration_ms: sessionDurationMs,
        query_type_label: "language_change_followup",
        detected_support_mode: "language_change_followup",
        user_query_type: "vocabulary_expression",
        feedback_target: null,
        source_types_used: [],
        visual_assets_used: [],
        retrieval_executed: false,
        retrieval_skipped_reason: "language_change_followup",
        incomplete_reason: error instanceof Error ? error.message : String(error),
      });

      return chatJsonResponse(
        responseFromText(text, requestId, isTimeout ? "timeout" : "error", isTimeout ? "timeout" : "error"),
        isTimeout ? 504 : 500
      );
    }
  }

  if (
    hasAmbiguousErroneousSentenceRequest(separatedTurn.currentRequest) &&
    !requestClassification.requires_source_context
  ) {
    const clarification = buildAmbiguousSentenceClarification(responseLanguage);

    await persistChatLog({
      ...commonLog,
      participant_id: participantId,
      session_id: sessionId,
      ep_id: epId,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: "allowed",
      status: "allowed",
      response_status: "success",
      retrieved_chunk_ids: [],
      retrieved_chunk_metadata: [],
      assistant_response: clarification,
      timestamp,
      response_length: clarification.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: "needs_meaning_clarification",
      detected_support_mode: "language_feedback",
      user_query_type: "feedback_checking",
      feedback_target: "language",
      source_types_used: [],
      visual_assets_used: [],
      retrieval_executed: false,
      retrieval_skipped_reason: "ambiguous_learner_sentence",
    });

    return chatJsonResponse(responseFromText(clarification, requestId, "success", null));
  }

  if (isMetaCapabilityQuestion(query)) {
    const response = buildMetaCapabilityResponse(responseLanguage);

    await persistChatLog({
      ...commonLog,
      participant_id: participantId,
      session_id: sessionId,
      ep_id: epId,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: "allowed",
      status: "allowed",
      response_status: "success",
      retrieved_chunk_ids: [],
      retrieved_chunk_metadata: [],
      assistant_response: response.text,
      timestamp,
      response_length: response.text.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: "procedural",
      detected_support_mode: "procedural",
      user_query_type: "procedural",
      source_types_used: [],
      visual_assets_used: [],
      retrieval_executed: false,
      retrieval_skipped_reason: "meta_capability",
    });

    return chatJsonResponse(responseFromText(response.text, requestId, "success", null));
  }

  if (containsGreeting(query) && isVagueHelpRequest(query) && !isGreeting(query)) {
    const response = buildGreetingClarificationResponse(responseLanguage);

    await persistChatLog({
      ...commonLog,
      participant_id: participantId,
      session_id: sessionId,
      ep_id: epId,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: "allowed",
      status: "allowed",
      response_status: "success",
      retrieved_chunk_ids: [],
      retrieved_chunk_metadata: [],
      assistant_response: response.text,
      timestamp,
      response_length: response.text.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: "others",
      detected_support_mode: "other",
      user_query_type: "others",
      source_types_used: [],
      visual_assets_used: [],
      retrieval_executed: false,
      retrieval_skipped_reason: "greeting_clarification",
    });

    return chatJsonResponse(responseFromText(response.text, requestId, "success", null, response.quickReplies));
  }

  if (isGreeting(query)) {
    const response = buildCalmGreetingResponse(responseLanguage);

    await persistChatLog({
      ...commonLog,
      participant_id: participantId,
      session_id: sessionId,
      ep_id: epId,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: "allowed",
      status: "allowed",
      response_status: "success",
      retrieved_chunk_ids: [],
      retrieved_chunk_metadata: [],
      assistant_response: response.text,
      timestamp,
      response_length: response.text.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: "others",
      detected_support_mode: "other",
      user_query_type: "others",
      source_types_used: [],
      visual_assets_used: [],
      retrieval_executed: false,
      retrieval_skipped_reason: "greeting",
    });

    return chatJsonResponse(responseFromText(response.text, requestId, "success", null, response.quickReplies));
  }

  if (isAmbiguousShortReaction(query) && !hasConversationContext) {
    const response = buildAmbiguousReactionResponseV2(responseLanguage);

    await persistChatLog({
      ...commonLog,
      participant_id: participantId,
      session_id: sessionId,
      ep_id: epId,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: "allowed",
      status: "allowed",
      response_status: "success",
      retrieved_chunk_ids: [],
      retrieved_chunk_metadata: [],
      assistant_response: response.text,
      timestamp,
      response_length: response.text.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: "ambiguous_short_reaction",
      source_types_used: [],
      visual_assets_used: [],
      retrieval_executed: false,
      retrieval_skipped_reason: "ambiguous_short_reaction_without_context",
    });

    return chatJsonResponse(responseFromText(response.text, requestId, "success", null, response.quickReplies));
  }

  if (isShortAcknowledgment(query) && !hasConversationContext) {
    const response = buildAcknowledgmentFollowUpV2(responseLanguage);

    await persistChatLog({
      ...commonLog,
      participant_id: participantId,
      session_id: sessionId,
      ep_id: epId,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: "allowed",
      status: "allowed",
      response_status: "success",
      retrieved_chunk_ids: [],
      retrieved_chunk_metadata: [],
      assistant_response: response.text,
      timestamp,
      response_length: response.text.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: "acknowledgment",
      source_types_used: [],
      visual_assets_used: [],
      retrieval_executed: false,
      retrieval_skipped_reason: "acknowledgment_without_context",
    });

    return chatJsonResponse(responseFromText(response.text, requestId, "success", null, response.quickReplies));
  }

  if (policyDecision === "restricted") {
    const redirected = redirectResponse(
      restrictionReason ?? "sentence_generation",
      responseLanguage,
      query
    );
    const redirectPayload: ChatApiResponse = {
      ok: true,
      requestId,
      status: "redirected",
      text: redirected,
      reason: restrictionReason ?? "sentence_generation",
      quickReplies: [],
    };

    await persistChatLog({
      ...commonLog,
      participant_id: participantId,
      session_id: sessionId,
      ep_id: epId,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: policyDecision,
      policy_reason: restrictionReason ?? "sentence_generation",
      status: "redirected",
      response_status: "redirected",
      retrieved_chunk_ids: [],
      retrieved_chunk_metadata: [],
      assistant_response: redirected,
      timestamp,
      response_length: redirected.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: "restricted",
      redirect_reason: restrictionReason ?? "sentence_generation",
      input_origin: inputOrigin,
      source_condition: condition,
      support_condition: "ai",
      detected_support_mode: "restricted",
      user_query_type: "restricted",
      feedback_target: policyAnalysis.feedbackTarget,
      source_types_used: [],
      visual_assets_used: [],
      retrieval_executed: false,
      retrieval_skipped_reason: "restricted_request",
    });

    return chatJsonResponse(redirectPayload);
  }

  if (shouldAskForUserDraftBeforeSource(query, conversationMemory.workingContext)) {
    const draftNeeded = buildNoChunkResponseV2("feedback", responseLanguage, "user_continuation");

    await persistChatLog({
      ...commonLog,
      participant_id: participantId,
      session_id: sessionId,
      ep_id: epId,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: "allowed",
      status: "allowed",
      response_status: "success",
      retrieved_chunk_ids: [],
      retrieved_chunk_metadata: [],
      assistant_response: draftNeeded.text,
      timestamp,
      response_length: draftNeeded.text.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: "feedback",
      detected_support_mode: "feedback_checking",
      user_query_type: "feedback_checking",
      source_types_used: [],
      visual_assets_used: [],
      retrieval_executed: false,
      retrieval_skipped_reason: "needs_learner_draft_before_retrieval",
    });

    return chatJsonResponse(responseFromText(draftNeeded.text, requestId, "success", null));
  }

  const shouldRunRetrieval =
    requestClassification.requires_source_context &&
    requestClassification.request_is_explicit &&
    requestClassification.confidence >= 0.58;
  const retrievalQuery = shouldRunRetrieval
    ? extractRetrievalQuery(separatedTurn.currentRequest || query)
    : "";
  const retrievalReason = shouldRunRetrieval
    ? `conditional_rag:${requestClassification.intent}`
    : null;
  const retrievalSkippedReason = shouldRunRetrieval
    ? null
    : requestClassification.intent === "language_change"
      ? "language_change_followup"
      : requestClassification.intent === "draft_only" ||
          requestClassification.intent === "unclear_intent"
        ? requestClassification.intent
        : "source_context_not_required";
  const retrievedChunks = shouldRunRetrieval
    ? retrieveTaskChunks(taskId, retrievalQuery, taskPackage, 3, true, conversationMemory)
    : [];

  if (
    shouldRunRetrieval &&
    shouldAskTargetClarification(
      query,
      supportMode,
      retrievedChunks.length > 0,
      conversationMemory.workingContext
    )
  ) {
    const clarification = buildTargetClarificationResponseV2(responseLanguage, supportMode);

    await persistChatLog({
      ...commonLog,
      participant_id: participantId,
      session_id: sessionId,
      ep_id: epId,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: "allowed",
      status: "allowed",
      retrieved_chunk_ids: [],
      retrieved_chunk_metadata: [],
      assistant_response: clarification.text,
      timestamp,
      response_length: clarification.text.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: "needs_target_clarification",
      source_types_used: [],
      visual_assets_used: [],
      retrieval_executed: true,
      retrieval_reason: retrievalReason,
    });

    return chatJsonResponse(
      responseFromText(clarification.text, requestId, "success", null, clarification.quickReplies)
    );
  }

  if (
    shouldRunRetrieval &&
    retrievedChunks.length === 0 &&
    !conversationMemory.isContextualFollowUp &&
    !conversationMemory.activeSupportContext
  ) {
    const boundedResponse = buildNoChunkResponseV2(
      supportMode,
      responseLanguage,
      conversationMemory.workingContext
    );

    await persistChatLog({
      ...commonLog,
      participant_id: participantId,
      session_id: sessionId,
      ep_id: epId,
      condition_label: taskPackage.config.ai_condition,
      selected_category: category,
      raw_user_query: query,
      policy_decision: "allowed",
      status: "allowed",
      response_status: "success",
      retrieved_chunk_ids: [],
      retrieved_chunk_metadata: [],
      assistant_response: boundedResponse.text,
      timestamp,
      response_length: boundedResponse.text.length,
      interaction_count: interactionCount,
      session_duration_ms: sessionDurationMs,
      query_type_label: supportMode,
      source_types_used: [],
      visual_assets_used: [],
      retrieval_executed: true,
      retrieval_reason: retrievalReason,
    });

    return chatJsonResponse(
      responseFromText(boundedResponse.text, requestId, "success", null, boundedResponse.quickReplies)
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    const text = participantErrorMessage(responseLanguage);
    await persistChatLog({
      ...commonLog,
      policy_decision: "allowed",
      status: "error",
      response_status: "error",
      retrieved_chunk_ids: retrievedChunks.map((chunk) => chunk.chunkId),
      retrieved_chunk_metadata: [],
      assistant_response: text,
      response_length: text.length,
      query_type_label: supportMode,
      source_types_used: [],
      visual_assets_used: [],
      retrieval_executed: shouldRunRetrieval,
      retrieval_reason: retrievalReason,
      retrieval_skipped_reason: retrievalSkippedReason,
      incomplete_reason: "missing_api_key",
    });

    return chatJsonResponse(responseFromText(text, requestId, "error", "service_unavailable"), 500);
  }

  const visualInputs = shouldRunRetrieval ? resolveVisualInputs(taskId, query, condition) : [];
  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 45000);

  const openAIRequest = {
    model,
    instructions: buildSystemInstruction(
      responseLanguage,
      supportMode,
      conversationMemory.workingContext === "user_continuation"
    ),
    max_output_tokens: Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 1200),
    input: [
      {
        role: "user" as const,
        content: [
          {
              type: "input_text" as const,
              text: buildUserInput(
              separatedTurn.currentRequest || query,
              category,
              taskPackage,
              retrievedChunks,
              supportMode,
              responseLanguage,
              conversationMemory,
              {
                includeSourceContext: shouldRunRetrieval,
                learnerDraft: separatedTurn.learnerDraft ||
                  (conversationMemory.workingContext === "user_continuation"
                    ? conversationMemory.continuationFocus || query
                    : undefined),
                scopeLimitations,
              }
            ),
          },
          ...visualInputs,
        ],
      },
    ],
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const openAIController = new AbortController();
      const timeout = setTimeout(() => openAIController.abort(), timeoutMs);
      const abortOpenAI = () => openAIController.abort();
      request.signal.addEventListener("abort", abortOpenAI, { once: true });

      const write = (event: ChatStreamEvent) => {
        try {
          controller.enqueue(encodeStreamEvent(event));
        } catch {
          openAIController.abort();
        }
      };

      write({ type: "start", requestId });

      try {
        const responseStream = await client.responses.create(
          {
            ...openAIRequest,
            stream: true,
          },
          { signal: openAIController.signal }
        );
        let streamedText = "";
        let finalResponse: OpenAIResponse | null = null;
        let incompleteReason: string | undefined;

        for await (const event of responseStream) {
          if (event.type === "response.output_text.delta") {
            streamedText += event.delta;
            write({ type: "delta", delta: event.delta });
          } else if (event.type === "response.completed") {
            finalResponse = event.response;
          } else if (event.type === "response.incomplete") {
            finalResponse = event.response;
            incompleteReason = event.response.incomplete_details?.reason;
          } else if (event.type === "response.failed") {
            finalResponse = event.response;
            throw new Error(event.response.error?.message || "response_failed");
          } else if (event.type === "error") {
            throw new Error(event.message || "response_error");
          }
        }

        clearTimeout(timeout);

        const assistantResponse = sanitizeAssistantResponse(
          streamedText || finalResponse?.output_text || ""
        );
        const responseStatus: ChatApiResponse["status"] =
          finalResponse?.status === "incomplete" || !assistantResponse
            ? "incomplete"
            : "success";
        const displayResponse = assistantResponse || participantErrorMessage(responseLanguage);

        await persistChatLog({
          ...commonLog,
          participant_id: participantId,
          session_id: sessionId,
          ep_id: epId,
          condition_label: taskPackage.config.ai_condition,
          selected_category: category,
          raw_user_query: query,
          policy_decision: "allowed",
          status: responseStatus,
          response_status: responseStatus,
          retrieved_chunk_ids: retrievedChunks.map((chunk) => chunk.chunkId),
          retrieved_chunk_metadata: retrievedChunks.map((chunk) => ({
            chunkId: chunk.chunkId,
            sourceId: chunk.sourceId,
            sourceType: chunk.sourceType,
            chunkIndex: chunk.chunkIndex,
            chunkCount: chunk.chunkCount,
            documentChunkIndex: chunk.documentChunkIndex,
            documentChunkCount: chunk.documentChunkCount,
            score: chunk.score,
          })),
          assistant_response: displayResponse,
          timestamp,
          response_length: displayResponse.length,
          interaction_count: interactionCount,
          session_duration_ms: sessionDurationMs,
          query_type_label: supportMode,
          source_types_used: [...new Set(retrievedChunks.map((chunk) => chunk.sourceType))],
          visual_assets_used: taskPackage.visualAssets
            .slice(0, visualInputs.length)
            .map((asset) => asset.id),
          retrieval_executed: shouldRunRetrieval,
          retrieval_reason: retrievalReason,
          retrieval_skipped_reason: retrievalSkippedReason,
          incomplete_reason: incompleteReason,
        });

        write({
          type: "done",
          payload: responseFromText(
            displayResponse,
            requestId,
            responseStatus,
            responseStatus === "incomplete" ? incompleteReason || "empty_response" : null
          ),
        });
      } catch (error) {
        clearTimeout(timeout);
        const isTimeout = error instanceof Error && error.name === "AbortError";
        const failureResponse = participantErrorMessage(responseLanguage);

        await persistChatLog({
          ...commonLog,
          participant_id: participantId,
          session_id: sessionId,
          ep_id: epId,
          condition_label: taskPackage.config.ai_condition,
          selected_category: category,
          raw_user_query: query,
          policy_decision: "allowed",
          status: isTimeout ? "timeout" : "error",
          response_status: isTimeout ? "timeout" : "error",
          retrieved_chunk_ids: retrievedChunks.map((chunk) => chunk.chunkId),
          retrieved_chunk_metadata: retrievedChunks.map((chunk) => ({
            chunkId: chunk.chunkId,
            sourceId: chunk.sourceId,
            sourceType: chunk.sourceType,
            chunkIndex: chunk.chunkIndex,
            chunkCount: chunk.chunkCount,
            documentChunkIndex: chunk.documentChunkIndex,
            documentChunkCount: chunk.documentChunkCount,
            score: chunk.score,
          })),
          assistant_response: failureResponse,
          timestamp,
          response_length: failureResponse.length,
          interaction_count: interactionCount,
          session_duration_ms: sessionDurationMs,
          query_type_label: supportMode,
          source_types_used: [...new Set(retrievedChunks.map((chunk) => chunk.sourceType))],
          visual_assets_used: taskPackage.visualAssets
            .slice(0, visualInputs.length)
            .map((asset) => asset.id),
          retrieval_executed: shouldRunRetrieval,
          retrieval_reason: retrievalReason,
          retrieval_skipped_reason: retrievalSkippedReason,
          incomplete_reason: error instanceof Error ? error.message : String(error),
        });

        write({
          type: "error",
          payload: responseFromText(
            failureResponse,
            requestId,
            isTimeout ? "timeout" : "error",
            isTimeout ? "timeout" : "error"
          ),
        });
      } finally {
        request.signal.removeEventListener("abort", abortOpenAI);
        clearTimeout(timeout);
        controller.close();
      }
    },
  });

  return chatStreamResponse(stream);
}
