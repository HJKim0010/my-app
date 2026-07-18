import type { TaskId } from "@/backend/rag/loader";
import type { RecentMessage } from "@/backend/rag/conversationMemory";

export type DetectedLanguage = "ko" | "en" | "mixed" | "unknown";

export type PreviousAssistantAct =
  | "offer"
  | "question"
  | "choice_request"
  | "explanation"
  | "feedback"
  | "correction"
  | "option_list"
  | "procedure"
  | "refusal"
  | "other";

export type FollowUpType =
  | "accept_previous_offer"
  | "reject_previous_offer"
  | "answer_previous_question"
  | "select_previous_option"
  | "ask_reason_about_previous_answer"
  | "ask_for_simpler_version"
  | "ask_for_alternative"
  | "ask_to_repeat"
  | "refer_to_previous_entity"
  | "refer_to_previous_expression"
  | "continue_same_topic"
  | "new_independent_request"
  | "uncertain";

export type FollowUpResolution = {
  isFollowUp: boolean;
  isShortFollowUp: boolean;
  type: FollowUpType;
  previousAssistantAct: PreviousAssistantAct;
  resolvedIntent?: string;
  resolvedAction?: string;
  anchorText?: string;
  referencedEntity?: string;
  detectedLanguage: DetectedLanguage;
  normalizedAnalysisText: string;
  confidence: number;
};

type OfferedOption = {
  index: number;
  text: string;
};

const TYPO_FIXES: Array<[RegExp, string]> = [
  [/studnet/gi, "student"],
  [/happend/gi, "happened"],
  [/expalin/gi, "explain"],
  [/grammer/gi, "grammar"],
  [/무서웟/gi, "무서웠"],
  [/근뎨/gi, "근데"],
  [/안집어/gi, "안 집어"],
  [/아나/gi, "Anna"],
  [/\banna\b/gi, "Anna"],
  [/ana/gi, "Anna"],
];

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function normalizeAnalysisText(text: string): string {
  let normalized = compactText(text).normalize("NFKC");

  for (const [pattern, replacement] of TYPO_FIXES) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized;
}

export function detectLanguage(text: string): DetectedLanguage {
  const hasKorean = /[\uac00-\ud7a3]/.test(text);
  const hasEnglish = /[a-z]/i.test(text);

  if (hasKorean && hasEnglish) {
    return "mixed";
  }

  if (hasKorean) {
    return "ko";
  }

  if (hasEnglish) {
    return "en";
  }

  return "unknown";
}

function latestMessage(recentMessages: RecentMessage[], role: RecentMessage["role"]): string {
  return [...recentMessages].reverse().find((message) => message.role === role)?.text || "";
}

function extractOptions(text: string): OfferedOption[] {
  const options: OfferedOption[] = [];

  for (const line of text.split(/\r?\n/)) {
    const match =
      line.match(/^\s*(?:#{1,4}\s*)?(\d+)\s*[\).:-]\s*(.+?)\s*$/) ||
      line.match(/^\s*(첫째|첫 번째|둘째|두 번째|셋째|세 번째|마지막)\s*(?:는|은|:|-)?\s*(.+?)\s*$/);

    if (!match) {
      continue;
    }

    const rawIndex = match[1];
    const index = /^\d+$/.test(rawIndex)
      ? Number(rawIndex)
      : rawIndex.includes("첫")
        ? 1
        : rawIndex.includes("둘") || rawIndex.includes("두")
          ? 2
          : rawIndex.includes("셋") || rawIndex.includes("세")
            ? 3
            : -1;

    if (index > 0) {
      options.push({ index, text: compactText(match[2]) });
    }
  }

  return options;
}

function detectOrdinalSelection(text: string, optionCount: number): number | null {
  const normalized = normalizeAnalysisText(text).toLowerCase();

  const numeric = normalized.match(/\b(?:option\s*)?([1-9])(?:st|nd|rd|th)?\b/);
  if (numeric) {
    const index = Number(numeric[1]);
    return index >= 1 && index <= optionCount ? index : null;
  }

  if (/(첫\s*번째|첫째|first)/i.test(normalized)) return optionCount >= 1 ? 1 : null;
  if (/(두\s*번째|둘째|second)/i.test(normalized)) return optionCount >= 2 ? 2 : null;
  if (/(세\s*번째|셋째|third)/i.test(normalized)) return optionCount >= 3 ? 3 : null;
  if (/(마지막|last)/i.test(normalized)) return optionCount >= 1 ? optionCount : null;

  return null;
}

function detectPreviousAssistantAct(previousAssistant: string): PreviousAssistantAct {
  const normalized = normalizeAnalysisText(previousAssistant).toLowerCase();

  if (!normalized) return "other";
  if (/(can't|cannot|not allowed|instead|대신|도와줄 수|제한|안 돼|할 수 없)/i.test(normalized)) return "refusal";
  if (extractOptions(previousAssistant).length >= 2) return "option_list";
  if (/(원하면|필요하면|줄게|드릴게|제공할게|i can give|i can help|would you like|do you want)/i.test(normalized)) {
    return "offer";
  }
  if (/(몇 단어|시간|사전|제출|과제|word count|dictionary|submit|time limit)/i.test(normalized)) return "procedure";
  if (/(corrected|수정|바꾸면|문법|grammar|natural|awkward|어색|자연)/i.test(normalized)) return "correction";
  if (/(feedback|피드백|확인할 점|logic|논리)/i.test(normalized)) return "feedback";
  if (/[?？]\s*$/.test(normalized)) return "question";

  return "explanation";
}

function isShortFollowUp(text: string): boolean {
  const normalized = normalizeAnalysisText(text);
  return normalized.length > 0 && normalized.length <= 90 && normalized.split(/\s+/).length <= 8;
}

function isAcknowledgment(text: string): boolean {
  return /^(네|넵|응|그래|좋아|좋아요|맞아|맞아요|ㅇㅇ|예|okay|ok|yes|yeah|yep|sure)[.!?\s]*$/i.test(
    normalizeAnalysisText(text)
  );
}

function acceptsPreviousAction(text: string): boolean {
  const normalized = normalizeAnalysisText(text);
  return (
    isAcknowledgment(normalized) ||
    /^(?:네|넵|응|그래|좋아|좋아요|예|yes|yeah|ok|okay|sure)[,\s]*(?:그렇게\s*)?(?:해\s*줘|해주세요|해줘|do that)?[.!?\s]*$/i.test(
      normalized
    ) ||
    /(?:그렇게\s*해\s*줘|그렇게\s*해주세요|do that|go ahead|that sounds good)/i.test(normalized)
  );
}

function referencesPreviousExpression(text: string): boolean {
  return /(표현|문장|sentence|expression|word|verb|단어|동사|아까|previous|that one|그거|그 문장|그 표현)/i.test(
    normalizeAnalysisText(text)
  );
}

function inferEntity(text: string, taskId: TaskId, recentText: string): string | undefined {
  const haystack = `${normalizeAnalysisText(text)}\n${normalizeAnalysisText(recentText)}`;

  if (/jack|잭/i.test(haystack) || (taskId === "task1" && /(주인공|he|him|그 사람|걔)/i.test(haystack))) {
    return "Jack";
  }

  if (/anna|애나|안나/i.test(haystack) || (taskId === "task2" && /(주인공|she|her|그 여자|걔)/i.test(haystack))) {
    return "Anna";
  }

  if (/(student id|학생증)/i.test(haystack)) return "student ID";
  if (/(wallet|지갑)/i.test(haystack)) return "wallet";
  if (/(box|package|상자|소포)/i.test(haystack)) return "box";
  if (/(black book|검은 책|책)/i.test(haystack)) return "black book";
  if (/(note|message|쪽지|메모|메시지)/i.test(haystack)) return "note";
  if (/(table 7|7번|테이블)/i.test(haystack)) return "table 7";

  return undefined;
}

export function resolveFollowUp(
  taskId: TaskId,
  currentUserMessage: string,
  recentMessages: RecentMessage[]
): FollowUpResolution {
  const normalized = normalizeAnalysisText(currentUserMessage);
  const detectedLanguage = detectLanguage(currentUserMessage);
  const previousAssistant = latestMessage(recentMessages, "assistant");
  const previousUser = latestMessage(recentMessages, "user");
  const previousAssistantAct = detectPreviousAssistantAct(previousAssistant);
  const short = isShortFollowUp(normalized);
  const options = extractOptions(previousAssistant);
  const selectedOption = detectOrdinalSelection(normalized, options.length);
  const recentText = recentMessages.slice(-6).map((message) => message.text).join("\n");
  const referencedEntity = inferEntity(normalized, taskId, `${previousUser}\n${previousAssistant}\n${recentText}`);

  if (!previousAssistant && !previousUser) {
    return {
      isFollowUp: false,
      isShortFollowUp: short,
      type: "new_independent_request",
      previousAssistantAct,
      detectedLanguage,
      normalizedAnalysisText: normalized,
      confidence: 0.9,
    };
  }

  if (selectedOption) {
    const option = options.find((item) => item.index === selectedOption);
    return {
      isFollowUp: true,
      isShortFollowUp: short,
      type: "select_previous_option",
      previousAssistantAct: "option_list",
      resolvedIntent: "option_selection",
      resolvedAction: `Continue with option ${selectedOption}: ${option?.text || "selected previous option"}`,
      anchorText: option?.text || previousAssistant,
      referencedEntity,
      detectedLanguage,
      normalizedAnalysisText: normalized,
      confidence: 0.96,
    };
  }

  if (
    acceptsPreviousAction(normalized) &&
    (previousAssistantAct === "offer" ||
      /(?:원하면|줄게|드릴게|해줄게|만들어|제시할게|나눠줄게|i can|would you like|do you want)/i.test(previousAssistant))
  ) {
    return {
      isFollowUp: true,
      isShortFollowUp: short,
      type: "accept_previous_offer",
      previousAssistantAct,
      resolvedIntent: "conversational_follow_up",
      resolvedAction: "Carry out the immediately previous assistant offer now.",
      anchorText: previousAssistant,
      referencedEntity,
      detectedLanguage,
      normalizedAnalysisText: normalized,
      confidence: 0.94,
    };
  }

  if (/(왜|why)\??$/i.test(normalized)) {
    return {
      isFollowUp: true,
      isShortFollowUp: short,
      type: "ask_reason_about_previous_answer",
      previousAssistantAct,
      resolvedIntent: "conversational_follow_up",
      resolvedAction: "Explain the reason for the immediately previous assistant answer or correction.",
      anchorText: previousAssistant,
      referencedEntity,
      detectedLanguage,
      normalizedAnalysisText: normalized,
      confidence: 0.9,
    };
  }

  if (/(좀\s*쉽게|더\s*쉽게|쉽게|simpler|make it easier|easy word|쉬운)/i.test(normalized)) {
    return {
      isFollowUp: true,
      isShortFollowUp: short,
      type: "ask_for_simpler_version",
      previousAssistantAct,
      resolvedIntent: "vocabulary_expression",
      resolvedAction: "Provide a simpler version of the previous expression, sentence, or explanation.",
      anchorText: previousAssistant,
      referencedEntity,
      detectedLanguage,
      normalizedAnalysisText: normalized,
      confidence: 0.92,
    };
  }

  if (/(다른\s*거|다른\s*표현|그거\s*말고|말고|other|another|instead)/i.test(normalized)) {
    return {
      isFollowUp: true,
      isShortFollowUp: short,
      type: /말고|instead/i.test(normalized) ? "reject_previous_offer" : "ask_for_alternative",
      previousAssistantAct,
      resolvedIntent: "conversational_follow_up",
      resolvedAction: "Offer an alternative to the previous suggestion without restarting the topic.",
      anchorText: previousAssistant,
      referencedEntity,
      detectedLanguage,
      normalizedAnalysisText: normalized,
      confidence: 0.88,
    };
  }

  if (/(다시|아까|repeat|again|previous|show me.*again)/i.test(normalized) && referencesPreviousExpression(normalized)) {
    return {
      isFollowUp: true,
      isShortFollowUp: short,
      type: "ask_to_repeat",
      previousAssistantAct,
      resolvedIntent: "conversational_follow_up",
      resolvedAction: "Repeat the relevant previous expression or explanation.",
      anchorText: previousAssistant,
      referencedEntity,
      detectedLanguage,
      normalizedAnalysisText: normalized,
      confidence: 0.9,
    };
  }

  if (short && /(그거|그건|이거|이건|아까|there|then|that|it|this|그럼|그러면|맞아\??|right\??)/i.test(normalized)) {
    return {
      isFollowUp: true,
      isShortFollowUp: short,
      type: referencesPreviousExpression(normalized) ? "refer_to_previous_expression" : "refer_to_previous_entity",
      previousAssistantAct,
      resolvedIntent: "conversational_follow_up",
      resolvedAction: "Resolve the vague reference from the immediately preceding conversation and answer within that topic.",
      anchorText: previousAssistant || previousUser,
      referencedEntity,
      detectedLanguage,
      normalizedAnalysisText: normalized,
      confidence: 0.82,
    };
  }

  if (short && previousAssistantAct === "question" && !/[?？]/.test(normalized)) {
    return {
      isFollowUp: true,
      isShortFollowUp: short,
      type: "answer_previous_question",
      previousAssistantAct,
      resolvedIntent: "conversational_follow_up",
      resolvedAction: "Treat the current short message as an answer to the previous assistant question.",
      anchorText: previousAssistant,
      referencedEntity,
      detectedLanguage,
      normalizedAnalysisText: normalized,
      confidence: 0.78,
    };
  }

  return {
    isFollowUp: short && Boolean(previousAssistant) ? /(그|that|it|this|why|왜|다시|again|더|more|해줘)/i.test(normalized) : false,
    isShortFollowUp: short,
    type: short ? "uncertain" : "new_independent_request",
    previousAssistantAct,
    anchorText: previousAssistant || previousUser,
    referencedEntity,
    detectedLanguage,
    normalizedAnalysisText: normalized,
    confidence: short ? 0.45 : 0.85,
  };
}
