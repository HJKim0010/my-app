import assert from "node:assert/strict";
import { analyzeQueryScope } from "../backend/policy/classifier.ts";
import { redirectResponse } from "../backend/policy/redirect.ts";
import {
  buildSystemInstruction,
  buildUserInput,
  detectSupportMode,
} from "../backend/rag/promptBuilder.ts";
import {
  looksLikeNewCurrentLanguageIntent,
  shouldTreatAsContinuationFollowUp,
} from "../backend/rag/contextPriority.ts";
import {
  detectMainCharacterNameRequest,
  detectMainCharacterNameAndStatusRequest,
  getMainCharacterName,
  getMainCharacterStatusSummary,
} from "../backend/rag/storyMetadata.ts";
import { buildChatLogPayload, buildSessionTranscriptPayload } from "../backend/logs/logger.ts";
import { detectIncompleteAnswerRepair } from "../backend/rag/incompleteAnswerRepair.ts";
import {
  buildAcknowledgmentOrInferenceResponse,
  buildAssistantMetaFeedbackResponse,
  buildContinuationStructureResponse,
  detectAcknowledgmentOrInference,
  detectAssistantMetaFeedback,
  detectContinuationStructureRequest,
} from "../backend/rag/conversationalAlignment.ts";
import {
  buildConcreteSaviorIdeasResponse,
  buildSelectedPreviousOptionResponse,
  extractOfferedOptions,
  planConversationTurn,
  resolvePreviousOptionSelection,
} from "../backend/rag/conversationPlanner.ts";

const previousCafeTurn = [
  { role: "user", text: "카페를 떠나는 표현은?" },
  { role: "assistant", text: "leave the cafe / go out of the cafe" },
  { role: "user", text: "table 7을 다시 확인하는 행동 순서를 봐줘." },
  { role: "assistant", text: "Anna가 table 7을 다시 확인하는 이유를 붙여보세요." },
];

// A. Latest request over stale context.
const latestExpression =
  "그 메시지에는 이 지역 8번가에 사는 남자이고, 당장 직업이 필요하여 이런 메시지를 남겼다고 이야기하려고.";
assert.equal(looksLikeNewCurrentLanguageIntent(latestExpression), true);
assert.equal(shouldTreatAsContinuationFollowUp(latestExpression, previousCafeTurn), false);
assert.equal(detectSupportMode(latestExpression), "language");

// B. One-sentence expression request.
const sentenceRequest = "그는 급하게 일자리를 구하고 있었다고 영어로 어떻게 말해?";
assert.equal(analyzeQueryScope(sentenceRequest).queryType, "allowed");
assert.equal(analyzeQueryScope(sentenceRequest).outputForm, "complete_sentence");

// C. Learner-authored sentence correction.
const correctionRequest = "He was urgently need a job. 자연스럽게 고쳐줘.";
assert.equal(analyzeQueryScope(correctionRequest).queryType, "allowed");
assert.equal(analyzeQueryScope(correctionRequest).detectedSupportMode, "feedback_checking");

// D. Compatible new continuation idea.
const compatibleIdea = "메시지를 남긴 사람이 근처에 사는 구직자였다는 설정은 어때?";
assert.equal(analyzeQueryScope(compatibleIdea).queryType, "allowed");
assert.equal(detectSupportMode(compatibleIdea), "ideas");

// E. Idea needing a causal bridge.
const bridgeIdea = "Anna가 갑자기 그 남자를 찾아가기로 하면 어때?";
assert.equal(analyzeQueryScope(bridgeIdea).queryType, "allowed");
assert.equal(detectSupportMode(bridgeIdea), "ideas");
assert.ok(buildSystemInstruction("korean", "ideas", false).includes("causal bridge"));

// F. Direct contradiction support is prompt-governed, not hardcoded.
assert.ok(buildSystemInstruction("korean", "ideas", false).includes("directly contradict"));
assert.ok(buildSystemInstruction("korean", "ideas", false).includes("explicit and stable source fact"));

// G. Mixed request combines source compatibility and English formulation.
const mixedRequest = "이 설정이 원래 이야기와 연결되는지 보고, 영어 문장도 만들어줘.";
assert.equal(analyzeQueryScope(mixedRequest).queryType, "allowed");
assert.equal(detectSupportMode(mixedRequest), "language");

// H. Source-only comprehension remains allowed.
const sourceOnly = "Anna가 table 7 아래에서 무엇을 발견했어?";
assert.equal(analyzeQueryScope(sourceOnly).queryType, "allowed");
assert.equal(detectSupportMode(sourceOnly), "comprehension");

// H2. Role-based factual source question: protagonist/main character name.
assert.equal(detectMainCharacterNameRequest("주인공 이름을 알려줘."), true);
assert.equal(detectMainCharacterNameRequest("Who is the main character?"), true);
assert.equal(getMainCharacterName("task1"), "Jack");
assert.equal(getMainCharacterName("task2"), "Anna");

// H3 / Test A. Multi-part protagonist question asks for both name and status.
assert.equal(detectMainCharacterNameAndStatusRequest("주인공 이름이랑 신분은?"), true);
const protagonistStatus = getMainCharacterStatusSummary("task1", "korean");
assert.ok(protagonistStatus.includes("Jack은 학생입니다"));
assert.ok(protagonistStatus.includes("대학생으로 볼 수 있어요"));

// I. Full paragraph ghostwriting remains restricted.
const paragraphRequest = "이 설정으로 다음 문단을 영어로 4문장 써줘.";
assert.equal(analyzeQueryScope(paragraphRequest).reason, "sentence_generation");
assert.ok(!redirectResponse("sentence_generation", "korean", paragraphRequest).includes("___"));

// J. Paragraph feedback remains allowed.
const paragraphFeedback =
  "Anna saw the message. She was scary and go outside. 문법이랑 흐름을 봐줘.";
assert.equal(analyzeQueryScope(paragraphFeedback).queryType, "allowed");
assert.equal(analyzeQueryScope(paragraphFeedback).detectedSupportMode, "feedback_checking");

// J2. English draft without an explicit question implies proofreading.
const implicitEnglishDraft =
  "Anna slowly approaches the table. She open the box and find a note. Her heart started beating fast.";
assert.equal(detectSupportMode(implicitEnglishDraft), "feedback");
assert.ok(
  buildSystemInstruction("english", "feedback", false).includes(
    "implicit request for proofreading"
  )
);

// K. Short contextual follow-up may use recent sentence options.
const optionHistory = [
  { role: "user", text: sentenceRequest },
  {
    role: "assistant",
    text:
      "1. He urgently needed a job. 2. He was desperately looking for work.",
  },
];
assert.equal(shouldTreatAsContinuationFollowUp("두 번째가 더 절박하게 들려?", optionHistory), true);

const task1 = {
  taskId: "task1",
  condition: "static",
  conditionLabel: "static_multimodal_condition",
  config: { ai_condition: "restricted_source_grounded_bounded_support" },
  documents: [],
  prompt: "EP1 prompt",
  instruction: "EP1 instruction",
  visualAssets: [],
};
const task2 = {
  taskId: "task2",
  condition: "static",
  conditionLabel: "static_multimodal_condition",
  config: { ai_condition: "restricted_source_grounded_bounded_support" },
  documents: [],
  prompt: "EP2 prompt",
  instruction: "EP2 instruction",
  visualAssets: [],
};

// L. EP isolation through task-specific prompt labels.
const task1Input = buildUserInput("What happened?", "Others", task1, [], "comprehension", "english");
const task2Input = buildUserInput("What happened?", "Others", task2, [], "comprehension", "english");
assert.ok(task1Input.includes("EP1 / Jack's story"));
assert.ok(task2Input.includes("EP2 / Anna's story"));
assert.ok(!task2Input.includes("EP1 / Jack's story"));

// M. Static/dynamic parity: writing support policy does not depend on condition.
assert.equal(detectSupportMode(sentenceRequest, "Language"), "language");
assert.ok(
  buildUserInput(sentenceRequest, "Language", { ...task2, condition: "dynamic" }, [], "language", "korean").includes(
    "Story knowledge is not required"
  )
);

// N. Source reconstruction request is restricted without exposing the source.
const reconstruction = "원래 이야기 전체를 다시 보여줘.";
assert.equal(analyzeQueryScope(reconstruction).reason, "sentence_generation");

// Source context strategy metadata can be embedded without overriding current request.
const fakeCanonicalChunk = {
  chunkId: "task2:source_text:0:canonical",
  taskId: "task2",
  sourceId: "source_text",
  sourceType: "source_text",
  sourceLabel: "Canonical Source Text",
  chunkIndex: 0,
  chunkCount: 1,
  documentChunkIndex: 0,
  documentChunkCount: 1,
  content: "Anna found a note connected to table 7.",
  score: 1,
};
const sourceInput = buildUserInput(sourceOnly, "Others", task2, [fakeCanonicalChunk], "comprehension", "korean", undefined, {
  includeSourceContext: true,
  sourceContextStrategy: "canonical_plus_rag",
});
assert.ok(sourceInput.includes("Source context strategy: canonical_plus_rag"));
assert.ok(sourceInput.includes("Do not let either override CURRENT_USER_REQUEST"));

// O. Factual story questions should use canonical source context before saying unavailable.
const sourceGroundingInstruction = buildSystemInstruction("korean", "comprehension", false);
assert.ok(sourceGroundingInstruction.includes("actively use the retrieved canonical source context"));
assert.ok(sourceGroundingInstruction.includes("genuinely lacks the fact"));

// P. Supabase chat_events compatibility mode keeps core logging fields when metadata columns are missing.
const sampleLogEntry = {
  participant_id: "reviewer",
  session_id: "session-1",
  ep_id: "ep2",
  condition_label: "static_multimodal_condition",
  selected_category: "내용 이해 / Understand the source",
  raw_user_query: "주인공 이름을 알려줘.",
  policy_decision: "allowed",
  policy_reason: "allowed",
  status: "allowed",
  response_status: "success",
  retrieved_chunk_ids: ["chunk-1"],
  retrieved_chunk_metadata: [],
  assistant_response: "주인공은 Anna입니다.",
  timestamp: "2026-07-17T00:00:00.000Z",
  response_length: 14,
  interaction_count: 1,
  session_duration_ms: 1000,
  query_type_label: "comprehension",
  source_context_strategy: "canonical_plus_rag",
  detected_functions: ["source_comprehension"],
  ghostwriting_boundary_triggered: false,
};
const fullPayload = buildChatLogPayload(sampleLogEntry);
const compatibilityPayload = buildChatLogPayload(sampleLogEntry, false, true);
assert.equal(fullPayload.source_context_strategy, "canonical_plus_rag");
assert.equal(compatibilityPayload.raw_user_query, sampleLogEntry.raw_user_query);
assert.ok(!("source_context_strategy" in compatibilityPayload));
assert.ok(!("policy_reason" in compatibilityPayload));
assert.ok(!("response_status" in compatibilityPayload));

const sampleTranscriptEntry = {
  participant_id: "reviewer",
  session_id: "session-1",
  ep_id: "ep2",
  condition_label: "static_multimodal_condition",
  source_condition: "static",
  support_condition: "ai",
  task_id: "task2",
  episode_id: "ep2",
  timestamp: "2026-07-17T00:00:00.000Z",
  interaction_count: 1,
  session_duration_ms: 1000,
  transcript: [
    { role: "user", text: "주인공 이름이랑 신분은?" },
    { role: "assistant", text: "주인공은 Anna입니다." },
  ],
};
const fullTranscriptPayload = buildSessionTranscriptPayload(sampleTranscriptEntry);
const compatibilityTranscriptPayload = buildSessionTranscriptPayload(
  sampleTranscriptEntry,
  false,
  true
);
assert.equal(fullTranscriptPayload.source_condition, "static");
assert.equal(compatibilityTranscriptPayload.session_id, "session-1");
assert.ok(!("source_condition" in compatibilityTranscriptPayload));
assert.ok(!("task_id" in compatibilityTranscriptPayload));

// Q. Incomplete multi-part answer repair: short keyword completes the omitted slot.
const incompleteMultiPartHistory = [
  { role: "user", text: "주인공 이름이랑 신분은?" },
  { role: "assistant", text: "주인공은 Jack입니다." },
];
const repair = detectIncompleteAnswerRepair("신분은!", incompleteMultiPartHistory);
assert.equal(repair?.slot, "status");
assert.equal(repair?.previousUserText, "주인공 이름이랑 신분은?");
assert.equal(
  getMainCharacterStatusSummary("task1", "korean").includes("Jack은 학생입니다"),
  true
);
assert.equal(
  getMainCharacterStatusSummary("task1", "korean").includes("대학생으로 볼 수 있어요"),
  true
);
assert.ok(
  buildSystemInstruction("korean", "comprehension", true).includes(
    "complete the omitted slot directly"
  )
);
assert.equal(detectIncompleteAnswerRepair("신분은!", [
  { role: "user", text: "주인공 이름이랑 신분은?" },
  { role: "assistant", text: "주인공은 Jack이고 학생입니다." },
]), null);

// R. Learner correction and rejection should replace the previous assistant focus.
const correctionPolicy = buildSystemInstruction("korean", "ideas", true);
assert.ok(correctionPolicy.includes("drop the rejected focus"));
assert.ok(correctionPolicy.includes("learner's correction as the current focus"));

// S. Task-related general knowledge is allowed for writing support, but not as source fact.
assert.ok(correctionPolicy.includes("General knowledge may be used"));
assert.ok(correctionPolicy.includes("must not be presented as information stated in the source"));
assert.equal(
  analyzeQueryScope("카페 직원이 이런 상황에서 경찰에게 뭐라고 할 수 있어?").queryType,
  "allowed"
);

// T. Multi-intent completeness is an explicit response-generation check.
assert.ok(correctionPolicy.includes("Have I answered every requested item"));

// U. Acknowledgment/inference should be answered directly without a progress push.
assert.equal(detectAcknowledgmentOrInference("오케이. 그러면 발표가 중요하겠네."), true);
const presentationInference = buildAcknowledgmentOrInferenceResponse(
  "오케이. 그러면 발표가 중요하겠네.",
  "task1",
  "korean"
);
assert.ok(presentationInference.includes("발표는 중요"));
assert.ok(presentationInference.includes("최종 성적") || presentationInference.includes("졸업"));
assert.ok(!presentationInference.includes("집"));
assert.ok(!presentationInference.includes("정해보세요"));

// V. Assistant-directed meta-feedback should adjust behavior, not ask a category question.
assert.equal(detectAssistantMetaFeedback("음.. 너무 푸쉬하는데?"), true);
const metaFeedback = buildAssistantMetaFeedbackResponse("음.. 너무 푸쉬하는데?", "korean");
assert.ok(metaFeedback.includes("재촉"));
assert.ok(metaFeedback.includes("요청할 때만"));
assert.ok(!metaFeedback.includes("어떤 도움이"));
assert.ok(!metaFeedback.includes("작성한 내용을 확인"));

// W. Continuation structure starts after the source ending and does not draft a paragraph.
assert.equal(detectContinuationStructureRequest("일단 내용을 어떻게 구성하면 좋을까?"), true);
const structurePlan = buildContinuationStructureResponse("task1", "korean");
assert.ok(structurePlan.includes("원문이 끝난 뒤"));
assert.ok(structurePlan.includes("결정"));
assert.ok(structurePlan.includes("결과"));
assert.ok(structurePlan.includes("발견"));
assert.ok(!structurePlan.includes("Jack had"));

// X. Source accuracy: EP1 wallet/student ID were forgotten or left behind, not lost.
assert.ok(buildSystemInstruction("korean", "comprehension", false).includes("forgot or left behind"));
assert.ok(buildSystemInstruction("korean", "language", false).includes("one complete English sentence"));

// Y. Semantic planner resolves broad acceptance to the immediately previous offer.
const saviorOfferHistory = [
  {
    role: "assistant",
    text: "원하면 구세주 등장 아이디어를 2개 정도 구체적으로 정리해드릴게요.",
  },
];
const acceptedSaviorPlan = planConversationTurn({
  query: "응 그렇게 해줘.",
  taskId: "task1",
  recentMessages: saviorOfferHistory,
  currentSupportMode: "ideas",
});
assert.equal(acceptedSaviorPlan.dialogue_act, "accept_previous_offer");
assert.ok(acceptedSaviorPlan.accepted_suggestions.includes("concrete_savior_ideas"));
const saviorResponse = buildConcreteSaviorIdeasResponse("task1");
assert.ok(saviorResponse.includes("구세주"));
assert.ok(saviorResponse.includes("팀원") || saviorResponse.includes("역 직원"));
assert.ok(!saviorResponse.includes("집으로 돌아"));

// Z. Planner treats omitted prior offer as repair, not source analysis.
const omittedSaviorPlan = planConversationTurn({
  query: "구세주 등장은 없어?",
  taskId: "task1",
  recentMessages: saviorOfferHistory,
  currentSupportMode: "ideas",
});
assert.equal(omittedSaviorPlan.conversation_operation, "repair_previous_omission");
assert.ok(omittedSaviorPlan.requested_outputs.includes("repair omitted prior offer"));

// AA. Planner records meta-feedback preferences as session diagnostics.
const pushyPlan = planConversationTurn({
  query: "음.. 너무 푸쉬하는데?",
  taskId: "task1",
  recentMessages: [{ role: "assistant", text: "이제 다음 단계를 골라 보세요." }],
});
assert.equal(pushyPlan.dialogue_act, "assistant_directed_feedback");
assert.equal(pushyPlan.progress_push_allowed, false);
assert.ok(pushyPlan.style_updates.includes("minimal_progress_push"));

// AB. Bare English draft is proofreading, not unclear intent.
const bareDraftPlan = planConversationTurn({
  query: implicitEnglishDraft,
  taskId: "task2",
  recentMessages: [],
});
assert.equal(bareDraftPlan.dialogue_act, "draft_submission");
assert.ok(bareDraftPlan.requested_outputs.includes("corrected version"));

// AC. Previous-option ordinal and semantic references resolve against the last assistant option list.
const previousOptionList = [
  "1. Trust the message and stay on the train.",
  "2. Get off early and hurry to school.",
  "3. Hesitate for several stops and decide later under increasing time pressure.",
].join("\n");
const offeredOptions = extractOfferedOptions(previousOptionList);
assert.equal(offeredOptions.length, 3);
assert.equal(resolvePreviousOptionSelection("세번째로 가자.", previousOptionList)?.index, 3);
assert.equal(resolvePreviousOptionSelection("3번으로 할게.", previousOptionList)?.index, 3);
assert.equal(resolvePreviousOptionSelection("마지막 방향이 좋아.", previousOptionList)?.index, 3);
assert.equal(resolvePreviousOptionSelection("Let's go with the hesitation option.", previousOptionList)?.index, 3);
const thirdOptionPlan = planConversationTurn({
  query: "세번째로 가자.",
  taskId: "task1",
  recentMessages: [{ role: "assistant", text: previousOptionList }],
});
assert.equal(thirdOptionPlan.dialogue_act, "select_previous_option");
assert.equal(thirdOptionPlan.conversation_operation, "continue_previous");
assert.equal(thirdOptionPlan.selected_option_index, 3);
assert.ok(thirdOptionPlan.selected_option_meaning.includes("Hesitate"));
assert.equal(thirdOptionPlan.clarification_needed, false);
assert.equal(thirdOptionPlan.progress_push_allowed, true);
const selectedOptionResponse = buildSelectedPreviousOptionResponse(
  { index: 3, description: thirdOptionPlan.selected_option_meaning },
  "task1"
);
assert.ok(selectedOptionResponse.includes("3번째 방향"));
assert.ok(selectedOptionResponse.includes("망설이는 전개"));
assert.ok(!selectedOptionResponse.includes("집으로 돌아"));

// AD. EP1 source-accuracy assertions are explicitly in the generation policy.
const ep1AccuracyPolicy = buildSystemInstruction("english", "ideas", false);
assert.ok(ep1AccuracyPolicy.includes("Jack's team depends on him"));
assert.ok(ep1AccuracyPolicy.includes("No teaching assistant is mentioned"));
assert.ok(ep1AccuracyPolicy.includes("Jack already has his bag and laptop"));
assert.ok(ep1AccuracyPolicy.includes("forgot or left behind his wallet and student ID"));
assert.ok(ep1AccuracyPolicy.includes("do not say he lost them"));

console.log("Writing assistant regression tests passed: A-AD plus planner/alignment/RAG/logging checks");
