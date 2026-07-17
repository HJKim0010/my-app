import assert from "node:assert/strict";
import {
  analyzeQueryScope,
  asksForFullSentenceTranslation,
} from "../backend/policy/classifier.ts";
import { redirectResponse } from "../backend/policy/redirect.ts";

const allowed = [
  "그는 급하게 일자리를 구하고 있었다고 영어로 어떻게 말해?",
  "기이하다 영어로",
  "닭살돋는 느낌 -> 영어로 알려줘",
  "He was urgently need a job. 자연스럽게 고쳐줘.",
  "메시지를 남긴 사람이 근처에 사는 구직자였다는 설정은 어때?",
  "이 설정이 원래 이야기와 연결되는지 보고, 영어 문장도 만들어줘.",
  "Can you proofread my paragraph and explain the main fixes?",
  "Anna가 table 7 아래에서 무엇을 발견했어?",
  "두 번째가 더 절박하게 들려?",
];

const restricted = [
  ["이 설정으로 다음 문단을 영어로 4문장 써줘.", "sentence_generation"],
  ["Write the next paragraph based on my idea.", "sentence_generation"],
  ["Please generate the full continuation.", "sentence_generation"],
  ["내 초안 전체를 모범답안처럼 다시 써줘.", "draft_rewrite"],
  ["이 글은 몇 점이야?", "scoring_evaluation"],
  ["Give me a rubric band.", "scoring_evaluation"],
];

for (const query of allowed) {
  const result = analyzeQueryScope(query);
  assert.equal(result.queryType, "allowed", `${query} should be allowed, got ${result.reason}`);
}

for (const query of [
  "Summarize the whole original story briefly.",
  "Give me a source recap and explain the order of events.",
  "원래 이야기 전체를 짧게 요약해줘.",
]) {
  const result = analyzeQueryScope(query);
  assert.equal(result.queryType, "allowed", `${query} should be allowed as source comprehension`);
  assert.equal(result.detectedSupportMode, "comprehension", `${query} should route to comprehension`);
}

for (const [query, reason] of restricted) {
  const result = analyzeQueryScope(query);
  assert.equal(result.queryType, "restricted", `${query} should be restricted`);
  assert.equal(result.reason, reason, `${query} should be ${reason}, got ${result.reason}`);
}

const oneSentence = "그는 급하게 일자리를 구하고 있었다고 영어로 어떻게 말해?";
assert.equal(
  asksForFullSentenceTranslation(oneSentence),
  true,
  "The classifier may detect a full-sentence expression request"
);
assert.equal(
  analyzeQueryScope(oneSentence).queryType,
  "allowed",
  "A one-sentence expression request must be allowed"
);
assert.equal(
  analyzeQueryScope(oneSentence).outputForm,
  "complete_sentence",
  "A one-sentence expression request should be tracked as complete_sentence"
);

const redirect = redirectResponse("sentence_generation", "korean", "다음 문단을 써줘.");
assert.ok(!redirect.includes("keywords"), "Redirect should not mechanically fall back to keyword extraction");
assert.ok(!redirect.includes("___"), "Redirect should not force a blank sentence frame");
assert.ok(/문단 전체|전개|한 문장/.test(redirect), "Redirect should offer a smaller allowed writing support action");

console.log(`Policy regression tests passed: ${allowed.length + restricted.length + 4} checks`);
