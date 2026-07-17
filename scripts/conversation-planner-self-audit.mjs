import assert from "node:assert/strict";
import {
  buildConcreteSaviorIdeasResponse,
  buildSelectedPreviousOptionResponse,
  planConversationTurn,
} from "../backend/rag/conversationPlanner.ts";
import { analyzeQueryScope } from "../backend/policy/classifier.ts";

const scenarios = [
  {
    name: "Scenario A: savior offer acceptance",
    taskId: "task1",
    turns: [
      {
        role: "assistant",
        text: "원하면 구세주 등장 아이디어를 2개 정도 구체적으로 정리해드릴게요.",
      },
    ],
    input: "응 그렇게 해줘.",
    expected: ["accept_previous_offer", "concrete_savior_ideas"],
    check(plan, response) {
      assert.equal(plan.conversation_operation, "accept_previous_offer");
      assert.ok(plan.accepted_suggestions.includes("concrete_savior_ideas"));
      assert.ok(response.includes("구세주"));
      assert.ok(!response.includes("집으로 돌아"));
    },
  },
  {
    name: "Scenario B: repair after omitted savior idea",
    taskId: "task1",
    turns: [
      {
        role: "assistant",
        text: "원하면 구세주 등장 아이디어를 2개 정도 구체적으로 정리해드릴게요.",
      },
    ],
    input: "구세주 등장은 없어?",
    expected: ["repair_previous_omission"],
    check(plan) {
      assert.equal(plan.conversation_operation, "repair_previous_omission");
      assert.ok(plan.requested_outputs.includes("repair omitted prior offer"));
    },
  },
  {
    name: "Scenario C: acknowledgment/inference",
    taskId: "task1",
    turns: [{ role: "assistant", text: "Jack의 발표는 최종 성적과 졸업에 영향을 줍니다." }],
    input: "오케이. 그러면 발표가 중요하겠네.",
    expected: ["acknowledge_user_inference", "canonical"],
    check(plan) {
      assert.equal(plan.conversation_operation, "acknowledge_user_inference");
      assert.equal(plan.progress_push_allowed, false);
      assert.equal(plan.source_strategy, "canonical");
    },
  },
  {
    name: "Scenario D: assistant-directed meta-feedback",
    taskId: "task1",
    turns: [{ role: "assistant", text: "이제 다음 선택을 골라 보세요." }],
    input: "음, 너무 푸쉬하는데?",
    expected: ["adjust_assistant_behavior", "minimal_progress_push"],
    check(plan) {
      assert.equal(plan.conversation_operation, "adjust_assistant_behavior");
      assert.ok(plan.style_updates.includes("minimal_progress_push"));
      assert.equal(plan.progress_push_allowed, false);
    },
  },
  {
    name: "Scenario E: missing-answer completion",
    taskId: "task1",
    turns: [
      { role: "user", text: "주인공 이름이랑 신분은?" },
      { role: "assistant", text: "주인공은 Jack입니다." },
    ],
    input: "신분은!",
    expected: ["complete_missing_answer", "status"],
    check(plan) {
      assert.equal(plan.conversation_operation, "complete_missing_answer");
      assert.ok(plan.unanswered_items.includes("status"));
    },
  },
  {
    name: "Scenario F: stale history overridden by current language request",
    taskId: "task2",
    turns: [
      { role: "user", text: "leave the cafe 표현은?" },
      { role: "assistant", text: "leave the cafe라고 할 수 있어요." },
      { role: "user", text: "table 7을 다시 확인하는 행동 순서를 봐줘." },
      { role: "assistant", text: "Anna가 table 7을 다시 확인한 이유를 붙여보세요." },
    ],
    input: "메시지를 남긴 사람은 8번가에 사는 남자이고 급하게 일자리를 구하고 있다고 말하려고.",
    expected: ["new_writing_request"],
    check(plan) {
      assert.equal(plan.conversation_operation, "new_request");
      assert.equal(plan.source_needed, false);
    },
  },
  {
    name: "Scenario H: bare draft",
    taskId: "task2",
    turns: [],
    input: "Anna open the box and find a note. She was scary because the message is strange.",
    expected: ["proofread_draft"],
    check(plan) {
      assert.equal(plan.conversation_operation, "proofread_draft");
      assert.ok(plan.requested_outputs.includes("corrected version"));
    },
  },
  {
    name: "Scenario J: previous-option ordinal selection",
    taskId: "task1",
    turns: [
      {
        role: "assistant",
        text: [
          "1. Trust the message and stay on the train.",
          "2. Get off early and hurry to school.",
          "3. Hesitate for several stops and decide later under increasing time pressure.",
        ].join("\n"),
      },
    ],
    input: "세번째로 가자.",
    expected: ["select_previous_option", "selected_option_3", "delayed decision"],
    check(plan, response) {
      assert.equal(plan.dialogue_act, "select_previous_option");
      assert.equal(plan.conversation_operation, "continue_previous");
      assert.equal(plan.selected_option_index, 3);
      assert.ok(plan.selected_option_meaning.includes("Hesitate"));
      assert.equal(plan.clarification_needed, false);
      assert.equal(plan.progress_push_allowed, true);
      assert.equal(plan.source_strategy, "none");
      assert.ok(response.includes("3번째 방향"));
      assert.ok(response.includes("망설이는 전개"));
      assert.ok(!response.includes("집으로 돌아"));
    },
  },
  {
    name: "Scenario I: ghostwriting boundary",
    taskId: "task1",
    turns: [],
    input: "이 설정으로 다음 문단을 영어로 4문장 써줘.",
    expected: ["restricted"],
    check() {
      assert.equal(analyzeQueryScope("이 설정으로 다음 문단을 영어로 4문장 써줘.").reason, "sentence_generation");
    },
  },
];

const report = [];

for (const scenario of scenarios) {
  const started = Date.now();
  const plan = planConversationTurn({
    query: scenario.input,
    taskId: scenario.taskId,
    recentMessages: scenario.turns,
  });
  const response = scenario.expected.includes("concrete_savior_ideas")
    ? buildConcreteSaviorIdeasResponse(scenario.taskId)
    : scenario.expected.includes("selected_option_3")
      ? buildSelectedPreviousOptionResponse(
          { index: plan.selected_option_index, description: plan.selected_option_meaning },
          scenario.taskId
        )
    : "";
  scenario.check(plan, response);
  report.push({
    test_name: scenario.name,
    input_turns: scenario.turns,
    current_input: scenario.input,
    planner_output: plan,
    source_strategy: plan.source_strategy,
    actual_assistant_response: response || "(response generated by normal chat path)",
    expected_properties: scenario.expected,
    pass: true,
    latency_ms: Date.now() - started,
  });
}

console.log(JSON.stringify(report, null, 2));
