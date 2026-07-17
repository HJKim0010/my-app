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
  getMainCharacterName,
} from "../backend/rag/storyMetadata.ts";

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

console.log("Writing assistant regression tests passed: A-N plus RAG structure checks");
