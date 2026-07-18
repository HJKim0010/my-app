import assert from "node:assert/strict";
import { analyzeQueryScope } from "../backend/policy/classifier.ts";
import { buildHistoryWithFallback } from "../backend/logs/sessionHistory.ts";
import { buildCanonicalTaskContext } from "../backend/rag/canonicalTaskContext.ts";
import { buildTurnPlan, canUseGenericClarification } from "../backend/rag/conversationOrchestrator.ts";
import { planConversationTurn } from "../backend/rag/conversationPlanner.ts";
import {
  normalizeAnalysisText,
  resolveFollowUp,
} from "../backend/rag/followUpResolver.ts";
import { loadTaskPackage } from "../backend/rag/loader.ts";

function assertIncludes(text, expected, label) {
  assert.ok(
    text.includes(expected),
    `${label}: expected to include ${JSON.stringify(expected)}`
  );
}

const followUpCases = [
  {
    name: "Korean short acknowledgment accepts previous expression offer",
    taskId: "task1",
    recentMessages: [
      {
        role: "assistant",
        text: "원하면 다음 장면에 사용할 자연스러운 영어 표현을 두 개 줄게.",
      },
    ],
    query: "네",
    expectedType: "accept_previous_offer",
  },
  {
    name: "English short acknowledgment accepts previous expression offer",
    taskId: "task1",
    recentMessages: [
      {
        role: "assistant",
        text: "I can give you two natural expressions.",
      },
    ],
    query: "Yes.",
    expectedType: "accept_previous_offer",
  },
  {
    name: "Korean ordinal selects previous option",
    taskId: "task1",
    recentMessages: [
      {
        role: "assistant",
        text: "1. 도움을 요청하는 방법\n2. 혼자 확인하는 방법",
      },
    ],
    query: "두 번째",
    expectedType: "select_previous_option",
    expectedAction: "option 2",
  },
  {
    name: "English ordinal selects previous option",
    taskId: "task2",
    recentMessages: [
      {
        role: "assistant",
        text: "1. Ask the staff for help.\n2. Check under the table by herself.",
      },
    ],
    query: "The second one.",
    expectedType: "select_previous_option",
    expectedAction: "option 2",
  },
  {
    name: "Simplification stays anchored to previous expression",
    taskId: "task2",
    recentMessages: [
      {
        role: "assistant",
        text: "`Anna hesitated before touching it.`가 자연스럽습니다.",
      },
    ],
    query: "좀 쉽게",
    expectedType: "ask_for_simpler_version",
  },
  {
    name: "Why asks reason about previous answer",
    taskId: "task1",
    recentMessages: [
      {
        role: "assistant",
        text: "`Jack was in a hurry`가 맞아요. 발표가 중요했기 때문입니다.",
      },
    ],
    query: "왜?",
    expectedType: "ask_reason_about_previous_answer",
  },
  {
    name: "Previous expression repeat is resolved",
    taskId: "task1",
    recentMessages: [
      {
        role: "assistant",
        text: "표현은 `He rushed out the door.`를 쓸 수 있어요.",
      },
    ],
    query: "아까 표현 다시",
    expectedType: "ask_to_repeat",
  },
];

for (const testCase of followUpCases) {
  const resolution = resolveFollowUp(
    testCase.taskId,
    testCase.query,
    testCase.recentMessages
  );

  assert.equal(resolution.type, testCase.expectedType, testCase.name);
  assert.equal(resolution.isFollowUp, true, testCase.name);
  assert.ok(resolution.confidence >= 0.78, testCase.name);

  if (testCase.expectedAction) {
    assertIncludes(resolution.resolvedAction || "", testCase.expectedAction, testCase.name);
  }
}

function makeRequestClassification(overrides = {}) {
  return {
    intent: "general_question",
    requires_source_context: false,
    requires_task_context: false,
    request_is_explicit: true,
    confidence: 0.8,
    ...overrides,
  };
}

function makeTurnPlan({ query, taskId = "task1", recentMessages = [], requestClassification = {} }) {
  const policyAnalysis = analyzeQueryScope(query);
  const conversationPlan = planConversationTurn({
    query,
    taskId,
    recentMessages,
  });

  return buildTurnPlan({
    rawUserMessage: query,
    taskId,
    recentMessages,
    policyAnalysis,
    requestClassification: makeRequestClassification(requestClassification),
    conversationPlan,
  });
}

const requiredFailureCases = [
  {
    name: "Case 1A accepts first-sentences offer",
    query: "네 그렇게 해줘.",
    recentMessages: [
      {
        role: "assistant",
        text: "원하면 제가 첫 1~2문장만 같이 만들어드릴게요.",
      },
    ],
    expected: {
      explicitIntent: "follow_up",
      followUpType: "accept_offer",
      responseMode: "direct_answer",
    },
  },
  {
    name: "Case 1B trailing English command wins",
    query: "Jack이 지갑과 학생증이 없다는 사실을 다시 확인하고 멈칫한다. 영어로",
    recentMessages: [
      {
        role: "assistant",
        text: "첫 번째 방향으로 가면 Jack이 집으로 돌아가는 흐름도 가능해요.",
      },
    ],
    expected: {
      explicitIntent: "translate",
      followUpType: "new_request",
      responseMode: "translation",
      targetIncludes: "지갑과 학생증",
    },
  },
  {
    name: "Case 1C multiline English command translates all target text",
    query: [
      "Jack이 지갑과 학생증이 없다는 사실을 다시 확인하고 멈칫한다.",
      "학생증이 꼭 필요하다고 판단해서, 늦더라도 집으로 돌아가거나 다른 해결 방법을 찾기로 한다.",
      "그 선택 때문에 발표에 더 늦을 위험이 커지고, Jack은 더 급하게 움직인다.",
      "",
      "영어로",
    ].join("\n"),
    recentMessages: [],
    requestClassification: { intent: "draft_only", request_is_explicit: false, confidence: 0.45 },
    expected: {
      explicitIntent: "translate",
      followUpType: "new_request",
      responseMode: "translation",
      targetIncludes: "학생증이 꼭 필요",
      clarificationAllowed: false,
    },
  },
  {
    name: "Case 2 accepts ending-direction offer",
    query: "응",
    recentMessages: [
      {
        role: "assistant",
        text: "원하면 다음엔 엔딩 방향 3개로 더 구체적으로 나눠줄게요.",
      },
    ],
    expected: {
      explicitIntent: "follow_up",
      followUpType: "accept_offer",
      responseMode: "direct_answer",
    },
  },
  {
    name: "Case 5 ghostwriting request becomes limited conversational help",
    query: "내 대신에 좀 써줘라. 이것좀",
    recentMessages: [
      {
        role: "assistant",
        text: "원하면 방금 고른 방향으로 첫 두 문장, 간단한 outline, 또는 표현을 도와줄 수 있어요.",
      },
    ],
    expected: {
      explicitIntent: "ghostwriting_request",
      followUpType: "new_request",
      responseMode: "limited_refusal",
      policyMode: "prohibited_ghostwriting",
    },
  },
];

for (const testCase of requiredFailureCases) {
  const plan = makeTurnPlan(testCase);
  assert.equal(plan.explicitIntent, testCase.expected.explicitIntent, testCase.name);
  assert.equal(plan.followUpType, testCase.expected.followUpType, testCase.name);
  assert.equal(plan.responseMode, testCase.expected.responseMode, testCase.name);
  assert.equal(canUseGenericClarification(plan), false, testCase.name);

  if (testCase.expected.policyMode) {
    assert.equal(plan.policyMode, testCase.expected.policyMode, testCase.name);
  }

  if (testCase.expected.targetIncludes) {
    assertIncludes(plan.targetText || "", testCase.expected.targetIncludes, testCase.name);
  }

  if ("clarificationAllowed" in testCase.expected) {
    assert.equal(plan.clarificationAllowed, testCase.expected.clarificationAllowed, testCase.name);
  }
}

const typoCases = [
  ["anna 왜 무서웟어", "Anna 왜 무서웠어"],
  ["Jack is studnet?", "Jack is student?"],
  ["what happend next?", "what happened next?"],
  ["can you expalin that?", "can you explain that?"],
  ["이거 grammer 맞아?", "이거 grammar 맞아?"],
];

for (const [input, expected] of typoCases) {
  assert.equal(normalizeAnalysisText(input), expected);
}

const turnPlanSignalCases = [
  {
    name: "English yes accepts concrete previous offer",
    query: "Yes",
    recentMessages: [{ role: "assistant", text: "I can give you three ending directions." }],
    expectedIntent: "follow_up",
    expectedFollowUp: "accept_offer",
    expectedMode: "direct_answer",
  },
  {
    name: "English second option selection stays anchored",
    query: "The second one",
    recentMessages: [{ role: "assistant", text: "1. Go home for the ID.\n2. Ask the teacher for another way." }],
    expectedIntent: "follow_up",
    expectedFollowUp: "select_option",
    expectedMode: "direct_answer",
  },
  {
    name: "Previous expression request stays anchored",
    query: "The previous one",
    recentMessages: [{ role: "assistant", text: "Try `Jack froze for a second.` or `Jack hesitated.`" }],
    expectedIntent: "follow_up",
    expectedFollowUp: "ask_repeat",
    expectedMode: "direct_answer",
  },
  {
    name: "Another expression stays anchored",
    query: "다른 표현",
    recentMessages: [{ role: "assistant", text: "`Jack hesitated.`가 자연스러워요." }],
    expectedIntent: "expression_help",
    expectedFollowUp: "new_request",
    expectedMode: "translation",
    targetIncludes: "Jack hesitated",
  },
  {
    name: "Standalone English command is translation",
    query: "Jack hesitated before leaving. In English",
    expectedIntent: "translate",
    expectedFollowUp: "new_request",
    expectedMode: "translation",
  },
  {
    name: "Grammar check explicit command wins",
    query: "Jack is student? 문법 맞아?",
    expectedIntent: "grammar_check",
    expectedFollowUp: "new_request",
    expectedMode: "correction",
  },
  {
    name: "Idea feedback explicit command wins",
    query: "Jack이 학생증 때문에 집에 돌아가는 아이디어 어때?",
    expectedIntent: "idea_feedback",
    expectedFollowUp: "new_request",
    expectedMode: "feedback",
  },
  {
    name: "Procedural word-count question wins",
    query: "몇 단어 써야 해?",
    expectedIntent: "procedural_question",
    expectedFollowUp: "new_request",
    expectedMode: "procedure",
  },
  {
    name: "Source summary requires canonical source",
    query: "source summary",
    expectedIntent: "source_summary",
    expectedFollowUp: "new_request",
    expectedMode: "explanation",
    requiresCanonicalSource: true,
  },
  {
    name: "Mixed typo story question normalizes internally",
    query: "Jack is studnet? what happend next?",
    expectedIntent: "source_question",
    expectedFollowUp: "new_request",
    expectedMode: "explanation",
  },
];

for (const testCase of turnPlanSignalCases) {
  const plan = makeTurnPlan(testCase);
  assert.equal(plan.explicitIntent, testCase.expectedIntent, testCase.name);
  assert.equal(plan.followUpType, testCase.expectedFollowUp, testCase.name);
  assert.equal(plan.responseMode, testCase.expectedMode, testCase.name);
  assert.equal(canUseGenericClarification(plan), false, testCase.name);

  if ("requiresCanonicalSource" in testCase) {
    assert.equal(plan.requiresCanonicalSource, testCase.requiresCanonicalSource, testCase.name);
  }

  if (testCase.targetIncludes) {
    assertIncludes(plan.targetText || "", testCase.targetIncludes, testCase.name);
  }
}

const twentyTurnHistory = Array.from({ length: 20 }, (_, index) => ({
  role: index % 2 === 0 ? "user" : "assistant",
  text: index % 2 === 0
    ? `turn ${index}: Jack asks about his student ID.`
    : `turn ${index}: 원하면 엔딩 방향 3개를 더 구체적으로 나눠줄게요.`,
}));
const twentyTurnPlan = makeTurnPlan({
  query: "응",
  recentMessages: twentyTurnHistory,
});
assert.equal(twentyTurnPlan.explicitIntent, "follow_up", "20-turn history accepts latest pending offer");
assert.equal(twentyTurnPlan.followUpType, "accept_offer", "20-turn history latest offer");
assert.equal(canUseGenericClarification(twentyTurnPlan), false, "20-turn history does not fallback");

const frontendHistory = await buildHistoryWithFallback({
  recentMessages: [
    { role: "user", text: "Can you give ideas?" },
    { role: "assistant", text: "I can give you three directions." },
  ],
  sessionId: "session-with-complete-frontend-history",
  epId: "ep1",
});
assert.equal(frontendHistory.historySource, "frontend", "complete frontend history is preserved");
assert.equal(frontendHistory.fallbackCount, 0, "complete frontend history does not fallback");
assert.equal(frontendHistory.messages.length, 2, "complete frontend history message count");

const ep1Static = buildCanonicalTaskContext(loadTaskPackage("task1", "static"));
const ep2Static = buildCanonicalTaskContext(loadTaskPackage("task2", "static"));

assert.equal(ep1Static.included, true);
assertIncludes(ep1Static.text, "Jack", "EP1 canonical context");
assertIncludes(ep1Static.text, "student ID", "EP1 canonical context");
assertIncludes(ep1Static.text, "120 and 350 words", "EP1 procedural context");
assert.ok(!ep1Static.text.includes("Anna went to a cafe"), "EP1 must not include EP2 source");

assert.equal(ep2Static.included, true);
assertIncludes(ep2Static.text, "Anna", "EP2 canonical context");
assertIncludes(ep2Static.text, "table 7", "EP2 canonical context");
assertIncludes(ep2Static.text, "120 and 350 words", "EP2 procedural context");
assert.ok(!ep2Static.text.includes("Jack had been preparing"), "EP2 must not include EP1 source");

const sourceQaFixtures = [
  ["task1", "Who is the protagonist?", "Protagonist: Jack"],
  ["task1", "Jack은 학생이야?", "Jack is a student"],
  ["task1", "Why was Jack in a hurry?", "presentation"],
  ["task1", "Who depended on Jack?", "team depends on him"],
  ["task1", "What did Jack prepare?", "team project presentation"],
  ["task1", "What happened to his alarms?", "alarms had failed"],
  ["task1", "What did Jack forget?", "student ID"],
  ["task1", "What else did Jack forget?", "wallet"],
  ["task1", "Where was Jack?", "subway station"],
  ["task1", "What happened to Jack's phone?", "fell under a seat"],
  ["task1", "Who helped Jack stand?", "woman"],
  ["task1", "What message did Jack receive?", "Get off at the last station"],
  ["task1", "What was Jack worried about?", "final grade"],
  ["task1", "What is the source ending point?", "what he decided"],
  ["task1", "Jack worked at the cafe, right?", "No cafe role"],
  ["task2", "Who is the protagonist?", "Protagonist: Anna"],
  ["task2", "Where was Anna?", "cafe"],
  ["task2", "Why did Anna go out?", "break after a long study session"],
  ["task2", "What was on the outdoor table?", "small box"],
  ["task2", "Was there a label?", "no label"],
  ["task2", "What did Anna order?", "ordered a coffee"],
  ["task2", "Where did Anna sit?", "near the window"],
  ["task2", "What was inside the box?", "thin black book"],
  ["task2", "What else was inside?", "folded note"],
  ["task2", "What did the note say?", "table 7"],
  ["task2", "Who was sitting at table 7?", "A man was sitting there"],
  ["task2", "What did the man do?", "left the cafe"],
  ["task2", "What was under table 7?", "something taped to the bottom"],
  ["task2", "How did Anna feel?", "heart started to beat faster"],
  ["task2", "Anna가 경찰을 불렀지?", "does not say that Anna called the police"],
];

for (const [taskId, , expectedEvidence] of sourceQaFixtures) {
  const context = buildCanonicalTaskContext(loadTaskPackage(taskId, "static"));
  assertIncludes(context.text, expectedEvidence, `${taskId} source QA evidence`);
}

console.log("Conversation continuity regression tests passed");
