import assert from "node:assert/strict";
import { buildCanonicalTaskContext } from "../backend/rag/canonicalTaskContext.ts";
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
