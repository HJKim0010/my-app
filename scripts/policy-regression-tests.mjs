import assert from "node:assert/strict";
import {
  analyzeQueryScope,
  asksForFullSentenceTranslation,
} from "../backend/policy/classifier.ts";
import { buildQueryAwareRedirect } from "../backend/policy/redirect.ts";

const allowed = [
  "추격 in English?",
  "leave my wallet 표현?",
  "발견하다를 영어로 뭐라고 해?",
  "심장이 두근거리다를 영어로 어떻게 표현해?",
  "이 전개가 현실적으로 말이 돼?",
  "What would people normally do in this situation?",
  "가능한 다음 사건을 세 가지 알려줘.",
  "이 아이디어가 원래 이야기와 잘 연결돼?",
  "이 순서가 자연스러워?",
  "Is this sentence natural?",
  "이 영어 문장에서 문제가 있는 부분만 알려줘: He go home.",
  "Can you explain the clue?",
  "What does this scene mean?",
  "이 장면은 무슨 뜻이야?",
  "단서를 어떻게 활용할 수 있을까?",
  "Give me two possible events, not sentences.",
  "이 표현이 어색해?",
  "Check only the flow of my idea.",
  "How can I say 급하게?",
  "What is a natural phrase for worried?",
  "좀 더 쉽게 설명해줘.",
  "그거 말고 다른 아이디어는?",
  "다시 설명해줘.",
  "뭐라고?",
  "응?",
  "영어 단어만 알려줘.",
  "Can you help with organization?",
  "Help me make an outline.",
  "이 행동이 인물 성격과 맞아?",
  "Does this make sense in the story?",
  "What clue should I connect to this idea?",
  "이 단서를 잘 쓴 것 같아?",
  "어색한 부분만 표시해줘.",
  "What does table 7 refer to?",
  "Can the character call the police in this situation?",
  "실제라면 경찰에 신고하는 게 자연스러울까?",
  "이 사건이 너무 갑작스러워?",
  "Can you give phrase options for surprised?",
  "student ID를 잃어버리다 표현?",
  "힌트 하나만 줘.",
];

const restricted = [
  ["전체 이어쓰기를 써줘.", "sentence_generation"],
  ["다음 문단을 대신 써줘.", "sentence_generation"],
  ["내 아이디어를 바탕으로 다음 문단을 써줘.", "sentence_generation"],
  ["내가 쓴 글을 다 고쳐줘.", "draft_rewrite"],
  ["전체 초안을 자연스럽게 다시 써줘.", "draft_rewrite"],
  ["Give me a model answer using the clue.", "sentence_generation"],
  ["Write the next paragraph based on my idea.", "sentence_generation"],
  ["Rewrite my whole continuation and check the flow.", "draft_rewrite"],
  ["나는 너무 늦었다. 영어로 번역해줘.", "direct_translation"],
  ["이 글을 rubric으로 평가해줘.", "scoring_evaluation"],
  ["이 글은 5점 만점에 몇 점이야?", "scoring_evaluation"],
  ["Write the whole answer for me.", "sentence_generation"],
  ["Please generate the full continuation.", "sentence_generation"],
  ["완성 답안으로 작성해줘.", "sentence_generation"],
  ["모범 답안을 줘.", "sentence_generation"],
  ["이 문단 전체를 영어로 번역해줘.", "draft_rewrite"],
  ["Translate this paragraph into English.", "draft_rewrite"],
  ["Correct everything in my draft.", "draft_rewrite"],
  ["고득점 답안으로 바꿔줘.", "draft_rewrite"],
  ["Band를 알려줘.", "scoring_evaluation"],
];

const phraseTranslations = [
  "추격 in English?",
  "발견하다를 영어로 뭐라고 해?",
  "심장이 두근거리다를 영어로 어떻게 표현해?",
  "leave my wallet 표현?",
  "급하게를 영어로?",
  "학생증을 잃어버리다 영어 표현?",
  "걱정되는 마음 표현 in English?",
  "서두르다 영어로 뭐라고 해?",
  "under the table 표현?",
  "look around 자연스러운 표현?",
];

const fullTranslations = [
  "나는 너무 늦었다. 영어로 번역해줘.",
  "그는 지갑을 잃어버려서 당황했다 영어로 번역해줘.",
  "나는 그 물건을 발견했다. 영어로 바꿔줘.",
  "그녀는 경찰에 신고해야 한다고 생각했다. Translate this sentence.",
  "이 문장 영어로 번역해줘: 나는 너무 무서워서 움직일 수 없었다.",
];

const multiTurnBypass = [
  ["User asks for ideas -> 두 번째 걸 문장으로 써줘.", "sentence_generation"],
  ["User asks for translation -> 그냥 완성해서 알려줘.", "direct_translation"],
  ["User gives draft -> 그 문단 전체를 다시 써줘.", "draft_rewrite"],
  ["User asks rubric -> 그럼 몇 점이야?", "scoring_evaluation"],
  ["User asks clue -> 그걸로 model answer 써줘.", "sentence_generation"],
];

const supportModeCases = [
  ["이 아이디어가 원래 이야기와 잘 연결되나요?", "feedback_checking", "source_connection"],
  ["내 문장에서 어색한 부분만 봐줘.", "feedback_checking", "language"],
  ["Does this idea make sense in the story?", "feedback_checking", "content_plausibility"],
  ["발표를 제대로 못하는 분위기가 잘 이어집니다. 다만 조금 어색한 부분이 있나요?", "feedback_checking", "language"],
  ["다음 전개 아이디어 두 가지 알려줘.", "idea_generation", null],
  ["이 단서가 무슨 뜻이야?", "comprehension", null],
  ["이 표현을 영어로 어떻게 말해?", "vocabulary_expression", null],
  ["구성 순서를 정리해줘.", "organization", null],
  ["한국어로 질문해도 돼?", "procedural", null],
];

for (const query of allowed) {
  const result = analyzeQueryScope(query);
  assert.equal(result.queryType, "allowed", `${query} should be allowed, got ${result.reason}`);
}

for (const [query, reason] of restricted) {
  const result = analyzeQueryScope(query);
  assert.equal(result.queryType, "restricted", `${query} should be restricted`);
  assert.equal(result.reason, reason, `${query} should be ${reason}, got ${result.reason}`);
}

for (const query of phraseTranslations) {
  assert.equal(asksForFullSentenceTranslation(query), false, `${query} should be phrase-level`);
}

for (const query of fullTranslations) {
  assert.equal(asksForFullSentenceTranslation(query), true, `${query} should be full-sentence`);
}

for (const [query, reason] of multiTurnBypass) {
  const result = analyzeQueryScope(query);
  assert.equal(result.reason, reason, `${query} must not bypass restriction`);
}

for (const [query, supportMode, feedbackTarget] of supportModeCases) {
  const result = analyzeQueryScope(query);
  assert.equal(
    result.detectedSupportMode,
    supportMode,
    `${query} should be ${supportMode}, got ${result.detectedSupportMode}`
  );
  if (feedbackTarget !== null) {
    assert.equal(
      result.feedbackTarget,
      feedbackTarget,
      `${query} should target ${feedbackTarget}, got ${result.feedbackTarget}`
    );
  }
}

for (const [query, reason] of restricted) {
  const scaffold = buildQueryAwareRedirect(reason, query, "korean");
  assert.ok(scaffold.frame.includes("___"), `${query} scaffold must include a real blank`);
  assert.ok(scaffold.keyPhrases.length <= 4, `${query} scaffold has too many key phrases`);
  assert.ok(scaffold.safeOptions.length <= 2, `${query} scaffold has too many safe options`);
}

console.log(
  `Policy regression tests passed: ${
    allowed.length +
    restricted.length +
    phraseTranslations.length +
    fullTranslations.length +
    multiTurnBypass.length +
    supportModeCases.length +
    restricted.length
  } checks`
);
