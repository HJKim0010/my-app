import type { ScopeDecision } from "../policy/classifier.ts";
import type { RecentMessage } from "./conversationMemory.ts";
import type { ConversationPlannerOutput } from "./conversationPlanner.ts";
import {
  normalizeAnalysisText,
  resolveFollowUp,
  type DetectedLanguage,
  type FollowUpResolution,
  type PreviousAssistantAct,
} from "./followUpResolver.ts";
import type { TaskId } from "./loader.ts";

export type ExplicitIntent =
  | "translate"
  | "grammar_check"
  | "expression_help"
  | "source_question"
  | "source_summary"
  | "idea_request"
  | "idea_feedback"
  | "organization_feedback"
  | "learner_text_feedback"
  | "procedural_question"
  | "follow_up"
  | "ghostwriting_request"
  | "off_task"
  | "unknown";

export type TurnPlanFollowUpType =
  | "accept_offer"
  | "reject_offer"
  | "select_option"
  | "ask_reason"
  | "ask_repeat"
  | "ask_simplify"
  | "ask_alternative"
  | "refer_previous_expression"
  | "refer_previous_entity"
  | "continue_topic"
  | "new_request"
  | "uncertain";

export type PolicyMode = "allowed" | "allowed_with_limits" | "prohibited_ghostwriting";

export type TurnPlanResponseMode =
  | "direct_answer"
  | "translation"
  | "correction"
  | "explanation"
  | "idea_options"
  | "feedback"
  | "procedure"
  | "limited_refusal";

export type ConversationState = {
  currentTopic?: string;
  currentEntity?: string;
  currentLearnerIdea?: string;
  currentTargetText?: string;
  lastAssistantAct?: PreviousAssistantAct;
  pendingOffer?: {
    action: string;
    target?: string;
  };
  pendingQuestion?: string;
  offeredOptions?: Array<{
    id: string;
    label: string;
    content: string;
  }>;
  lastProvidedExpressions?: string[];
  lastCorrection?: string;
  lastSourceFact?: string;
};

export type TurnPlan = {
  rawUserMessage: string;
  normalizedMessage: string;
  detectedLanguage: DetectedLanguage;
  explicitIntent: ExplicitIntent;
  resolvedIntent: string;
  secondaryIntents: string[];
  isFollowUp: boolean;
  followUpType: TurnPlanFollowUpType;
  previousAssistantAct: PreviousAssistantAct;
  pendingAction?: string;
  selectedOption?: string;
  targetText?: string;
  referencedEntity?: string;
  requiresCanonicalSource: boolean;
  requiresSupplementaryRetrieval: boolean;
  policyMode: PolicyMode;
  responseMode: TurnPlanResponseMode;
  confidence: number;
  conversationState: ConversationState;
  clarificationAllowed: boolean;
};

type RequestIntentSignal = {
  intent: string;
  requires_source_context: boolean;
  requires_task_context?: boolean;
  request_is_explicit: boolean;
  confidence: number;
};

type BuildTurnPlanParams = {
  rawUserMessage: string;
  taskId: TaskId;
  recentMessages: RecentMessage[];
  policyAnalysis: ScopeDecision;
  requestClassification: RequestIntentSignal;
  conversationPlan: ConversationPlannerOutput;
  followUpResolution?: FollowUpResolution;
};

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function previousMessage(recentMessages: RecentMessage[], role: RecentMessage["role"]): string {
  return [...recentMessages].reverse().find((message) => message.role === role)?.text || "";
}

function stripExplicitTranslationCommand(text: string): string {
  return compactText(
    text
      .replace(/(?:영어로|번역해줘|translate(?:\s+this)?|in english|into english)\s*[.!?。！？]*$/i, "")
      .replace(/^(?:영어로|translate|in english|into english)[:,\s]*/i, "")
  );
}

function detectExplicitIntent(normalized: string, policyAnalysis: ScopeDecision): ExplicitIntent {
  const lowered = normalized.toLowerCase();

  if (/(영어로|번역해줘|translate|in english|into english)\s*[.!?。！？]*$/i.test(normalized)) {
    return "translate";
  }

  if (/(내\s*대신|대신\s*써|써줘라|써\s*줘라|이것좀|이거\s*좀\s*써|write\s+(?:it|this|the).*for\s+me|write\s+for\s+me|do\s+it\s+for\s+me)/i.test(lowered)) {
    return "ghostwriting_request";
  }

  if (policyAnalysis.reason === "sentence_generation" || policyAnalysis.reason === "draft_rewrite") {
    return "ghostwriting_request";
  }

  if (policyAnalysis.taskRelevance === "task_unrelated") {
    return "off_task";
  }

  if (/(문법|맞아\??|맞나요|correct\??|grammar|grammer|natural\??|자연스러|어색|awkward)/i.test(lowered)) {
    return "grammar_check";
  }

  if (/(몇\s*단어|몇단어|몇\s*자|시간|끝까지|결말|제출|사전|사용해도|과제|word count|how many words|ending|submit|dictionary|time limit)/i.test(lowered)) {
    return "procedural_question";
  }

  if (/(표현|단어|동사|다른 표현|영어 표현|expression|phrase|word|verb|more natural|other expression)/i.test(lowered)) {
    return "expression_help";
  }

  if (/(요약|줄거리|summary|summarize|recap)/i.test(lowered)) {
    return "source_summary";
  }

  if (/(어때|말이 돼|괜찮|논리적|make sense|logical|does this idea)/i.test(lowered)) {
    return "idea_feedback";
  }

  if (/(아이디어|전개|다음 사건|어떻게 이어|what could happen|idea|ideas|brainstorm)/i.test(lowered)) {
    return "idea_request";
  }

  if (/(누구|어디|언제|왜|무엇|뭐였|무슨|source|story|jack|anna|학생|카페|지갑|학생증|상자|쪽지|테이블|what happened|where|who|why was|did .*right)/i.test(lowered)) {
    return "source_question";
  }

  if (/(구성|순서|흐름|organization|organize|sequence|flow)/i.test(lowered)) {
    return "organization_feedback";
  }

  if (/(피드백|봐줘|확인|check|feedback|review)/i.test(lowered)) {
    return "learner_text_feedback";
  }

  return "unknown";
}

function mapFollowUpType(type: FollowUpResolution["type"]): TurnPlanFollowUpType {
  switch (type) {
    case "accept_previous_offer":
      return "accept_offer";
    case "reject_previous_offer":
      return "reject_offer";
    case "select_previous_option":
      return "select_option";
    case "ask_reason_about_previous_answer":
      return "ask_reason";
    case "ask_to_repeat":
      return "ask_repeat";
    case "ask_for_simpler_version":
      return "ask_simplify";
    case "ask_for_alternative":
      return "ask_alternative";
    case "refer_to_previous_expression":
      return "refer_previous_expression";
    case "refer_to_previous_entity":
      return "refer_previous_entity";
    case "continue_same_topic":
      return "continue_topic";
    case "new_independent_request":
      return "new_request";
    default:
      return "uncertain";
  }
}

function responseModeForIntent(intent: ExplicitIntent, followUpType: TurnPlanFollowUpType): TurnPlanResponseMode {
  if (intent === "ghostwriting_request") return "limited_refusal";
  if (intent === "translate") return "translation";
  if (intent === "grammar_check") return "correction";
  if (intent === "expression_help") return "translation";
  if (intent === "idea_request") return "idea_options";
  if (intent === "idea_feedback" || intent === "organization_feedback" || intent === "learner_text_feedback") {
    return "feedback";
  }
  if (intent === "procedural_question") return "procedure";
  if (intent === "source_question" || intent === "source_summary") return "explanation";
  if (intent === "follow_up") {
    if (followUpType === "ask_simplify" || followUpType === "ask_alternative" || followUpType === "refer_previous_expression") {
      return "translation";
    }
    if (followUpType === "ask_reason") return "explanation";
    if (followUpType === "select_option" || followUpType === "accept_offer") return "direct_answer";
  }

  return "direct_answer";
}

function buildConversationState(
  recentMessages: RecentMessage[],
  followUp: FollowUpResolution
): ConversationState {
  const previousAssistant = previousMessage(recentMessages, "assistant");
  const previousUser = previousMessage(recentMessages, "user");
  const expressions = [...previousAssistant.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  const offeredOptions = previousAssistant
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(\d+)\s*[\).:-]\s*(.+?)\s*$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      id: match[1],
      label: `option_${match[1]}`,
      content: compactText(match[2]),
    }));

  return {
    currentTopic: followUp.anchorText || previousUser || undefined,
    currentEntity: followUp.referencedEntity,
    currentLearnerIdea: previousUser || undefined,
    currentTargetText: expressions.at(-1) || previousUser || undefined,
    lastAssistantAct: followUp.previousAssistantAct,
    pendingOffer:
      followUp.previousAssistantAct === "offer"
        ? {
            action: followUp.resolvedAction || "Carry out the previous assistant offer.",
            target: previousAssistant,
          }
        : undefined,
    pendingQuestion: followUp.previousAssistantAct === "question" ? previousAssistant : undefined,
    offeredOptions: offeredOptions.length ? offeredOptions : undefined,
    lastProvidedExpressions: expressions.length ? expressions : undefined,
    lastCorrection: followUp.previousAssistantAct === "correction" ? previousAssistant : undefined,
    lastSourceFact: /source|story|원문|이야기|Jack|Anna/i.test(previousAssistant)
      ? previousAssistant
      : undefined,
  };
}

function targetTextForIntent(raw: string, explicitIntent: ExplicitIntent): string | undefined {
  if (explicitIntent === "translate") {
    return stripExplicitTranslationCommand(raw);
  }

  const quoted = raw.match(/["'“”‘’`]([^"'“”‘’`]+)["'“”‘’`]/)?.[1];
  return quoted ? compactText(quoted) : undefined;
}

export function buildTurnPlan(params: BuildTurnPlanParams): TurnPlan {
  const followUp = params.followUpResolution || resolveFollowUp(
    params.taskId,
    params.rawUserMessage,
    params.recentMessages
  );
  const normalizedMessage = normalizeAnalysisText(params.rawUserMessage);
  const explicitIntent = detectExplicitIntent(normalizedMessage, params.policyAnalysis);
  const hasCurrentExplicitIntent = explicitIntent !== "unknown";
  const isFollowUp = !hasCurrentExplicitIntent && followUp.isFollowUp && followUp.confidence >= 0.7;
  const effectiveIntent: ExplicitIntent = hasCurrentExplicitIntent
    ? explicitIntent
    : isFollowUp
      ? "follow_up"
      : params.requestClassification.requires_task_context
        ? "procedural_question"
        : params.requestClassification.requires_source_context
          ? "source_question"
          : "unknown";
  const followUpType = isFollowUp ? mapFollowUpType(followUp.type) : "new_request";
  const policyMode: PolicyMode =
    params.policyAnalysis.queryType === "restricted" || effectiveIntent === "ghostwriting_request"
      ? "prohibited_ghostwriting"
      : effectiveIntent === "idea_request" || effectiveIntent === "learner_text_feedback"
        ? "allowed_with_limits"
        : "allowed";
  const responseMode = responseModeForIntent(effectiveIntent, followUpType);
  const requiresCanonicalSource =
    effectiveIntent === "source_question" ||
    effectiveIntent === "source_summary" ||
    effectiveIntent === "idea_request" ||
    effectiveIntent === "idea_feedback" ||
    effectiveIntent === "organization_feedback" ||
    params.conversationPlan.source_strategy === "canonical" ||
    params.conversationPlan.source_strategy === "canonical_plus_rag";
  const requiresSupplementaryRetrieval =
    requiresCanonicalSource &&
    !isFollowUp &&
    (params.requestClassification.intent === "source_comprehension" ||
      params.requestClassification.intent === "source_alignment" ||
      params.conversationPlan.source_strategy === "targeted_rag" ||
      params.conversationPlan.source_strategy === "canonical_plus_rag");
  const secondaryIntents = [
    params.requestClassification.intent,
    params.conversationPlan.dialogue_act,
    params.conversationPlan.conversation_operation,
  ].filter((item, index, items) => item && items.indexOf(item) === index);
  const confidence = Math.max(
    hasCurrentExplicitIntent ? 0.9 : 0,
    isFollowUp ? followUp.confidence : 0,
    params.requestClassification.confidence * 0.8,
    params.conversationPlan.confidence * 0.8
  );
  const conversationState = buildConversationState(params.recentMessages, followUp);
  const targetText =
    targetTextForIntent(params.rawUserMessage, effectiveIntent) ||
    (effectiveIntent === "expression_help" || effectiveIntent === "grammar_check"
      ? conversationState.currentTargetText
      : undefined);

  return {
    rawUserMessage: params.rawUserMessage,
    normalizedMessage,
    detectedLanguage: followUp.detectedLanguage,
    explicitIntent: effectiveIntent,
    resolvedIntent: effectiveIntent === "follow_up" ? followUp.resolvedIntent || followUpType : effectiveIntent,
    secondaryIntents,
    isFollowUp,
    followUpType,
    previousAssistantAct: followUp.previousAssistantAct,
    pendingAction: isFollowUp ? followUp.resolvedAction : undefined,
    selectedOption: followUpType === "select_option" ? followUp.anchorText : undefined,
    targetText,
    referencedEntity: followUp.referencedEntity,
    requiresCanonicalSource,
    requiresSupplementaryRetrieval,
    policyMode,
    responseMode,
    confidence: Math.min(0.98, confidence || 0.5),
    conversationState,
    clarificationAllowed: !hasCurrentExplicitIntent && !isFollowUp && confidence < 0.58,
  };
}

export function canUseGenericClarification(turnPlan: TurnPlan): boolean {
  return turnPlan.clarificationAllowed && turnPlan.explicitIntent === "unknown";
}
