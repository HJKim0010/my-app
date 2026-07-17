import type { RecentMessage } from "./conversationMemory.ts";
import type { TaskId } from "./loader.ts";
import {
  detectAcknowledgmentOrInference,
  detectAssistantMetaFeedback,
  detectContinuationStructureRequest,
} from "./conversationalAlignment.ts";
import { detectIncompleteAnswerRepair } from "./incompleteAnswerRepair.ts";

export type PlannerDialogueAct =
  | "new_writing_request"
  | "source_question"
  | "draft_submission"
  | "feedback_request"
  | "accept_previous_offer"
  | "select_previous_option"
  | "reject_previous_suggestion"
  | "correct_previous_interpretation"
  | "complete_missing_answer"
  | "acknowledgment_or_inference"
  | "assistant_directed_feedback"
  | "request_task_progression"
  | "confusion_or_restatement"
  | "social_response";

export type PlannerConversationOperation =
  | "new_request"
  | "continue_previous"
  | "complete_missing_answer"
  | "accept_previous_offer"
  | "repair_previous_omission"
  | "reject_previous_suggestion"
  | "correct_previous_interpretation"
  | "acknowledge_user_inference"
  | "adjust_assistant_behavior"
  | "continuation_structure"
  | "proofread_draft"
  | "none";

export type PlannerSourceStrategy = "none" | "canonical" | "targeted_rag" | "canonical_plus_rag";

export type ConversationPlannerOutput = {
  dialogue_act: PlannerDialogueAct;
  conversation_operation: PlannerConversationOperation;
  current_goal: string | null;
  resolved_references: string[];
  requested_outputs: string[];
  active_learner_direction: string | null;
  accepted_suggestions: string[];
  rejected_directions: string[];
  unanswered_items: string[];
  source_needed: boolean;
  source_strategy: PlannerSourceStrategy;
  source_reason: string | null;
  response_scope: "direct_answer" | "concise_support" | "full_support" | "clarification";
  clarification_needed: boolean;
  progress_push_allowed: boolean;
  style_updates: string[];
  planner_status: "ok" | "llm" | "fallback";
  planner_latency_ms: number;
  fallback_reason: string | null;
  selected_option_index: number | null;
  selected_option_meaning: string | null;
  confidence: number;
  planner_error_type: string | null;
  fallback_used: boolean;
};

const MAX_TURN_CHARS = 220;

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalize(text: string): string {
  return compactText(text).toLowerCase();
}

function truncateTurn(text: string): string {
  const compacted = compactText(text);
  return compacted.length > MAX_TURN_CHARS ? `${compacted.slice(0, MAX_TURN_CHARS - 1)}…` : compacted;
}

function lastMessage(recentMessages: RecentMessage[], role: RecentMessage["role"]): string {
  return truncateTurn([...recentMessages].reverse().find((message) => message.role === role)?.text || "");
}

function lastMessageFull(recentMessages: RecentMessage[], role: RecentMessage["role"]): string {
  return [...recentMessages].reverse().find((message) => message.role === role)?.text || "";
}

function recentRawTurns(recentMessages: RecentMessage[]): string[] {
  return recentMessages.slice(-8).map((message) => `${message.role}: ${truncateTurn(message.text)}`);
}

type OfferedOption = {
  index: number;
  label: string;
  description: string;
};

function cleanOptionText(text: string): string {
  return compactText(
    text
      .replace(/^\s*(?:#{1,4}\s*)?\d+\s*[\).:-]?\s*/g, "")
      .replace(/^\s*[-*]\s*/g, "")
      .replace(/\*\*/g, "")
  );
}

export function extractOfferedOptions(assistantText: string): OfferedOption[] {
  const lines = assistantText.split(/\r?\n/);
  const options: OfferedOption[] = [];
  let current: OfferedOption | null = null;

  for (const line of lines) {
    const optionMatch = line.match(/^\s*(?:#{1,4}\s*)?(\d+)\s*[\).:-]\s*(.+?)\s*$/);

    if (optionMatch) {
      if (current) {
        options.push({
          ...current,
          description: compactText(current.description),
        });
      }

      const index = Number(optionMatch[1]);
      const label = cleanOptionText(optionMatch[2]);
      current = {
        index,
        label,
        description: label,
      };
      continue;
    }

    if (current && /^\s*[-*]\s+/.test(line)) {
      current.description = compactText(`${current.description} ${cleanOptionText(line)}`);
    }
  }

  if (current) {
    options.push({
      ...current,
      description: compactText(current.description),
    });
  }

  return options.filter((option) => option.index > 0 && option.description.length > 0);
}

function detectOrdinalSelection(query: string, optionCount: number): number | null {
  const normalized = normalize(query);

  if (!normalized || optionCount < 1) {
    return null;
  }

  const ordinalMatch =
    normalized.match(/\b([1-9])\s*(?:번|번째|st|nd|rd|th|option)\b/i) ||
    normalized.match(/\b(?:option\s*)?([1-9])\b/i);

  if (ordinalMatch) {
    const index = Number(ordinalMatch[1]);
    return index >= 1 && index <= optionCount ? index : null;
  }

  if (/(첫\s*번째|첫번째|첫\s*번|1번|first)/i.test(normalized)) {
    return optionCount >= 1 ? 1 : null;
  }

  if (/(두\s*번째|두번째|둘\s*째|2번|second)/i.test(normalized)) {
    return optionCount >= 2 ? 2 : null;
  }

  if (/(세\s*번째|세번째|셋\s*째|3번|third)/i.test(normalized)) {
    return optionCount >= 3 ? 3 : null;
  }

  if (/(마지막|last|그중\s*마지막|끝\s*에\s*있는)/i.test(normalized)) {
    return optionCount;
  }

  return null;
}

function scoreSemanticOptionMatch(query: string, option: OfferedOption): number {
  const normalizedQuery = normalize(query);
  const normalizedOption = normalize(`${option.label} ${option.description}`);
  let score = 0;

  const semanticGroups = [
    ["망설", "hesitat", "decide later", "나중에", "시간 압박", "time pressure", "increasing"],
    ["일찍", "내리", "get off", "early", "hurry to school", "학교"],
    ["믿", "message", "메시지", "train", "stay on the train", "기차", "지하철"],
    ["help", "도움", "staff", "직원", "ask for help"],
    ["wallet", "student id", "지갑", "학생증", "id"],
  ];

  for (const group of semanticGroups) {
    const queryHit = group.some((term) => normalizedQuery.includes(term));
    const optionHit = group.some((term) => normalizedOption.includes(term));

    if (queryHit && optionHit) {
      score += 3;
    }
  }

  for (const token of normalizedQuery.split(/[^a-z0-9가-힣]+/i).filter((part) => part.length >= 2)) {
    if (normalizedOption.includes(token)) {
      score += 1;
    }
  }

  return score;
}

export function resolvePreviousOptionSelection(
  query: string,
  previousAssistant: string
): OfferedOption | null {
  const options = extractOfferedOptions(previousAssistant);

  if (options.length === 0) {
    return null;
  }

  const ordinalIndex = detectOrdinalSelection(query, options.length);

  if (ordinalIndex) {
    return options.find((option) => option.index === ordinalIndex) || null;
  }

  const ranked = options
    .map((option) => ({ option, score: scoreSemanticOptionMatch(query, option) }))
    .sort((a, b) => b.score - a.score);

  if (ranked[0]?.score >= 3 && ranked[0].score > (ranked[1]?.score || 0)) {
    return ranked[0].option;
  }

  return null;
}

function detectsAcceptance(query: string): boolean {
  const normalized = normalize(query);

  if (!normalized || normalized.length > 80) {
    return false;
  }

  return /^(yes|yeah|yep|ok|okay|sure|do that|yes,?\s*do that|that one|go with that|좋아|좋아요|응|응응|네|넵|그래|그래요|그렇게 해줘|그걸로 가자|그걸로 할게|그 방향|그 방향으로|아까 말한 거|방금 말한 방식|두 번째 걸로|그거 두 개|그거 두 개만)[.!?\s]*$/i.test(
    normalized
  ) || /(그렇게|그걸로|그 방향|방금 말한|아까 말한|do that|go with that).*(해줘|가자|할게|구체|풀어|보여)/i.test(normalized);
}

function detectsRejectionOrCorrection(query: string): boolean {
  const normalized = normalize(query);

  return /(아니|그게 아니|그 남자 말고|그 여자 말고|말고|취소|문법 말고|이야기 말고|not that|no,?\s*not|instead|cancel that)/i.test(
    normalized
  );
}

function detectsSourceQuestion(query: string): boolean {
  const normalized = normalize(query);

  return /(주인공|이름|신분|누구|왜|이유|어디|장소|source|original story|main character|who|why|where|what happened|story says)/i.test(
    normalized
  );
}

function detectsDraftSubmission(query: string): boolean {
  const normalized = compactText(query);
  const englishWords = normalized.match(/[A-Za-z]+/g)?.length || 0;
  const sentenceMarks = normalized.match(/[.!?]/g)?.length || 0;

  return englishWords >= 8 && sentenceMarks >= 1 && !/(in english|translate|어떻게|피드백|고쳐|수정|봐줘|check|fix|correct|review)/i.test(normalized);
}

function detectsFeedbackRequest(query: string): boolean {
  return /(feedback|proofread|check|fix|correct|review|natural|awkward|피드백|검토|수정|고쳐|봐줘|자연스럽|어색|문법)/i.test(
    query
  );
}

function detectsTaskProgression(query: string): boolean {
  return /(next step|what next|다음 단계|이제 뭐|그다음|계속 진행|이어가|진행)/i.test(query);
}

function extractStyleUpdates(query: string): string[] {
  const normalized = normalize(query);
  const updates: string[] = [];

  if (/(too\s*long|too\s*wordy|답.*너무\s*길|너무\s*길)/i.test(normalized)) {
    updates.push("concise_responses");
  }

  if (/(too\s*pushy|push|푸쉬|재촉|다음\s*단계.*하지|이어가.*마)/i.test(normalized)) {
    updates.push("minimal_progress_push");
  }

  if (/(only\s*answer|질문.*만|묻어본\s*것|내\s*질문)/i.test(normalized)) {
    updates.push("answer_exact_question_only");
  }

  if (/(문법\s*설명.*필요\s*없|no\s*grammar\s*explanation)/i.test(normalized)) {
    updates.push("no_unsolicited_grammar_explanation");
  }

  return updates;
}

function extractActiveDirectionFromHistory(recentMessages: RecentMessage[]): string | null {
  const candidates = recentMessages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-6)
    .map((message) => truncateTurn(message.text))
    .filter((text) =>
      /(구세주|savior|help arrives|도와주는|teammate|팀원|남자|여자|direction|방향|아이디어|전개|table\s*7|발표|presentation)/i.test(
        text
      )
    );

  return candidates[candidates.length - 1] || null;
}

function extractPreviousOffer(previousAssistant: string): string | null {
  if (!previousAssistant) {
    return null;
  }

  if (/(구세주|savior).*(아이디어|ideas)|아이디어.*(구세주|savior)/i.test(previousAssistant)) {
    return "concrete_savior_ideas";
  }

  if (/(event\s*sequence|사건\s*순서|흐름|3\s*steps|three\s*steps)/i.test(previousAssistant)) {
    return "event_sequence";
  }

  if (/(2|two|두).*(아이디어|ideas|options|가지)/i.test(previousAssistant)) {
    return "two_ideas";
  }

  return null;
}

function extractUnansweredItems(query: string, recentMessages: RecentMessage[]): string[] {
  const repair = detectIncompleteAnswerRepair(query, recentMessages);

  if (repair) {
    return [repair.slot];
  }

  const normalized = normalize(query);
  if (/(안\s*말했|빼먹|누락|그\s*부분|나머지|where is|what about)/i.test(normalized)) {
    return ["previous_omission"];
  }

  return [];
}

function sourceStrategyFor(act: PlannerDialogueAct, sourceNeeded: boolean): PlannerSourceStrategy {
  if (!sourceNeeded) {
    return "none";
  }

  if (act === "source_question" || act === "complete_missing_answer" || act === "acknowledgment_or_inference") {
    return "canonical";
  }

  return "canonical_plus_rag";
}

function sourceReasonFor(act: PlannerDialogueAct, sourceNeeded: boolean): string | null {
  if (!sourceNeeded) {
    return null;
  }

  if (act === "source_question") {
    return "source_question";
  }

  if (act === "complete_missing_answer") {
    return "missing_answer_repair";
  }

  if (act === "acknowledgment_or_inference") {
    return "confirm_learner_inference";
  }

  if (act === "request_task_progression") {
    return "source_grounded_task_progression";
  }

  return "source_grounded_writing_support";
}

export function planConversationTurn(params: {
  query: string;
  taskId: TaskId;
  recentMessages: RecentMessage[];
  currentSupportMode?: string;
}): ConversationPlannerOutput {
  const started = Date.now();

  try {
    const query = params.query;
    const recentMessages = params.recentMessages;
    const previousAssistant = lastMessage(recentMessages, "assistant");
    const previousAssistantFull = lastMessageFull(recentMessages, "assistant");
    const previousUser = lastMessage(recentMessages, "user");
    const previousOffer = extractPreviousOffer(previousAssistantFull || previousAssistant);
    const selectedOption = resolvePreviousOptionSelection(query, previousAssistantFull || previousAssistant);
    const unansweredItems = extractUnansweredItems(query, recentMessages);
    const acceptedOffer = detectsAcceptance(query) ? previousOffer : null;
    const isRepairAfterOmission =
      unansweredItems.length > 0 ||
      (/구세주|savior/i.test(query) && previousOffer === "concrete_savior_ideas") ||
      (/안\s*말했|빼먹|누락|그\s*부분|나머지/i.test(query) && previousAssistant.length > 0);
    const styleUpdates = extractStyleUpdates(query);
    const isMetaFeedback = detectAssistantMetaFeedback(query) || styleUpdates.length > 0;
    const isAcknowledgment = detectAcknowledgmentOrInference(query);
    const isCorrection = detectsRejectionOrCorrection(query);
    const isStructure = detectContinuationStructureRequest(query);
    const isDraft = detectsDraftSubmission(query);
    const isFeedback = detectsFeedbackRequest(query);
    const isSource = detectsSourceQuestion(query);
    const isProgression = detectsTaskProgression(query);
    const activeDirection = extractActiveDirectionFromHistory(recentMessages);

    let dialogueAct: PlannerDialogueAct = "new_writing_request";
    let operation: PlannerConversationOperation = "new_request";
    let sourceNeeded = false;
    let requestedOutputs: string[] = [];
    let responseScope: ConversationPlannerOutput["response_scope"] = "concise_support";
    const clarificationNeeded = false;
    let progressPushAllowed = false;

    if (selectedOption) {
      dialogueAct = "select_previous_option";
      operation = "continue_previous";
      requestedOutputs = [`selected_option_${selectedOption.index}`];
      sourceNeeded = false;
      responseScope = "concise_support";
      progressPushAllowed = true;
    } else if (isMetaFeedback) {
      dialogueAct = "assistant_directed_feedback";
      operation = "adjust_assistant_behavior";
      requestedOutputs = ["acknowledge style feedback", "state adjustment"];
      responseScope = "direct_answer";
    } else if (isRepairAfterOmission) {
      dialogueAct = unansweredItems.length > 0 ? "complete_missing_answer" : "confusion_or_restatement";
      operation = unansweredItems.length > 0 ? "complete_missing_answer" : "repair_previous_omission";
      requestedOutputs = unansweredItems.length > 0 ? unansweredItems : ["repair omitted prior offer"];
      sourceNeeded = unansweredItems.length > 0 || isSource;
      responseScope = "direct_answer";
    } else if (acceptedOffer) {
      dialogueAct = "accept_previous_offer";
      operation = "accept_previous_offer";
      requestedOutputs = [acceptedOffer];
      sourceNeeded = false;
      responseScope = "concise_support";
    } else if (isCorrection) {
      dialogueAct = "correct_previous_interpretation";
      operation = "correct_previous_interpretation";
      requestedOutputs = ["acknowledge correction", "use corrected direction"];
      responseScope = "direct_answer";
    } else if (isAcknowledgment) {
      dialogueAct = "acknowledgment_or_inference";
      operation = "acknowledge_user_inference";
      requestedOutputs = ["confirm or correct inference"];
      sourceNeeded = true;
      responseScope = "direct_answer";
    } else if (isStructure) {
      dialogueAct = "new_writing_request";
      operation = "continuation_structure";
      requestedOutputs = ["continuation structure"];
      sourceNeeded = true;
      responseScope = "concise_support";
    } else if (isDraft && !isFeedback) {
      dialogueAct = "draft_submission";
      operation = "proofread_draft";
      requestedOutputs = ["corrected version", "brief key changes"];
      responseScope = "concise_support";
    } else if (isFeedback) {
      dialogueAct = "feedback_request";
      operation = "new_request";
      requestedOutputs = ["writing feedback"];
      responseScope = "concise_support";
    } else if (isSource) {
      dialogueAct = "source_question";
      operation = "new_request";
      requestedOutputs = ["source-grounded answer"];
      sourceNeeded = true;
      responseScope = "direct_answer";
    } else if (isProgression) {
      dialogueAct = "request_task_progression";
      operation = "new_request";
      requestedOutputs = ["next step support"];
      sourceNeeded = true;
      responseScope = "concise_support";
      progressPushAllowed = true;
    } else if (/^(hi|hello|안녕|좋아|오케이|ok|okay)[.!?\s]*$/i.test(compactText(query))) {
      dialogueAct = "social_response";
      operation = "none";
      requestedOutputs = ["brief acknowledgment"];
      responseScope = "direct_answer";
    } else {
      requestedOutputs = ["answer current request"];
      progressPushAllowed = isProgression;
    }

    return {
      dialogue_act: dialogueAct,
      conversation_operation: operation,
      current_goal: previousUser || activeDirection || null,
      resolved_references: [
        ...recentRawTurns(recentMessages).slice(-4),
        previousOffer ? `previous_offer:${previousOffer}` : "",
      ].filter(Boolean),
      requested_outputs: requestedOutputs,
      active_learner_direction: selectedOption?.description || activeDirection,
      accepted_suggestions: acceptedOffer ? [acceptedOffer] : [],
      rejected_directions: isCorrection ? [previousAssistant || previousUser].filter(Boolean) : [],
      unanswered_items: unansweredItems,
      source_needed: sourceNeeded,
      source_strategy: sourceStrategyFor(dialogueAct, sourceNeeded),
      source_reason: sourceReasonFor(dialogueAct, sourceNeeded),
      response_scope: responseScope,
      clarification_needed: clarificationNeeded,
      progress_push_allowed: progressPushAllowed,
      style_updates: styleUpdates,
      planner_status: "ok",
      planner_latency_ms: Date.now() - started,
      fallback_reason: null,
      selected_option_index: selectedOption?.index || null,
      selected_option_meaning: selectedOption?.description || null,
      confidence: selectedOption || acceptedOffer ? 0.94 : isMetaFeedback || isAcknowledgment ? 0.9 : 0.78,
      planner_error_type: null,
      fallback_used: false,
    };
  } catch (error) {
    return {
      dialogue_act: "new_writing_request",
      conversation_operation: "new_request",
      current_goal: null,
      resolved_references: [],
      requested_outputs: ["answer current request"],
      active_learner_direction: null,
      accepted_suggestions: [],
      rejected_directions: [],
      unanswered_items: [],
      source_needed: false,
      source_strategy: "none",
      source_reason: null,
      response_scope: "concise_support",
      clarification_needed: false,
      progress_push_allowed: false,
      style_updates: [],
      planner_status: "fallback",
      planner_latency_ms: Date.now() - started,
      fallback_reason: error instanceof Error ? error.message : String(error),
      selected_option_index: null,
      selected_option_meaning: null,
      confidence: 0.4,
      planner_error_type: error instanceof Error ? error.name || "planner_error" : "planner_error",
      fallback_used: true,
    };
  }
}

export function buildSelectedPreviousOptionResponse(
  selectedOption: Pick<OfferedOption, "index" | "description">,
  taskId: TaskId
): string {
  const description = selectedOption.description;
  const ordinal = selectedOption.index === 1 ? "첫 번째" : selectedOption.index === 2 ? "두 번째" : `${selectedOption.index}번째`;
  const isHesitation = /(망설|hesitat|decide later|시간 압박|time pressure|increasing)/i.test(description);

  if (isHesitation) {
    return [
      `좋아요. **${ordinal} 방향**, 즉 **시간 압박 속에서 바로 결정하지 못하고 망설이는 전개**로 가면 됩니다.`,
      "",
      "- Jack이 메시지를 믿어야 할지, 학교로 빨리 가야 할지 계속 갈등합니다.",
      "- 역이 몇 개 지나가면서 발표 시간은 더 가까워지고 긴장이 커집니다.",
      "- 마지막에는 더 이상 미룰 수 없는 순간이 와서 Jack이 한 가지 선택을 하게 만들면 좋아요.",
      "",
      "이 방향은 Jack의 발표 압박과 이상한 메시지를 둘 다 살릴 수 있어요.",
    ].join("\n");
  }

  return [
    `좋아요. **${ordinal} 방향**으로 가면 됩니다.`,
    "",
    `선택한 방향: ${description}`,
    "",
    taskId === "task2"
      ? "이제 Anna의 선택이 어떤 단서나 위험으로 이어지는지만 정하면 흐름이 자연스러워요."
      : "이제 Jack의 선택이 발표 압박, 시간 지연, 또는 메시지의 의미와 어떻게 연결되는지만 정하면 됩니다.",
  ].join("\n");
}

export function buildConcreteSaviorIdeasResponse(taskId: TaskId): string {
  if (taskId === "task2") {
    return [
      "좋아요. 구세주가 등장하는 방향이면 이렇게 두 가지로 잡을 수 있어요.",
      "",
      "- **카페 직원이 도와주는 방향**: Anna가 table 7 밑의 물건 때문에 망설일 때, 직원이 다가와서 그 테이블에 예전에도 수상한 일이 있었다고 말해 줍니다.",
      "- **낯선 손님이 도와주는 방향**: Anna가 위험하다고 느끼는 순간, 한 손님이 조용히 경고하면서 그 물건을 지금 열지 말라고 알려 줍니다.",
      "",
      "둘 다 원문에 새로 붙이는 continuation idea라서, source fact처럼 단정하지 않고 가능한 전개로 쓰면 됩니다.",
    ].join("\n");
  }

  return [
    "좋아요. 구세주가 등장하는 방향이면 이렇게 두 가지로 잡을 수 있어요.",
    "",
    "- **팀원이 도와주는 방향**: Jack이 발표에 늦을 위기에 놓였을 때, 팀원이 먼저 발표를 시작하거나 Jack의 자료를 대신 열어 시간을 벌어 줍니다.",
    "- **역 직원이나 승객이 도와주는 방향**: Jack이 지갑과 학생증을 두고 온 상황을 설명하자, 누군가 학교까지 갈 수 있는 현실적인 방법을 알려 줍니다.",
    "",
    "이건 원문에 확정된 사실이 아니라, 원문과 모순되지 않게 붙일 수 있는 continuation idea로 다루면 됩니다.",
  ].join("\n");
}
