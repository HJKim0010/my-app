import assert from "node:assert/strict";
import {
  looksLikeNewCurrentLanguageIntent,
  shouldTreatAsContinuationFollowUp,
} from "../backend/rag/contextPriority.ts";
import {
  buildSystemInstruction,
  detectSupportMode,
} from "../backend/rag/promptBuilder.ts";

const previousCafeTurn = [
  { role: "user", text: "카페를 떠나는 표현은?" },
  {
    role: "assistant",
    text: "표현: leave the cafe / go out of the cafe.",
  },
  {
    role: "user",
    text: "그럼 table 7을 다시 확인하는 행동 순서가 자연스러운지 봐줘.",
  },
  {
    role: "assistant",
    text: "Anna가 cafe를 나갔다가 table 7을 다시 확인하는 흐름은 가능해요.",
  },
];

const currentExpression =
  "그 메시지에는 이 지역 8번가에 사는 남자이고, 당장 직업이 필요하여 이런 메시지를 남겼다고 이야기하려고.";

assert.equal(
  looksLikeNewCurrentLanguageIntent(currentExpression),
  true,
  "A new Korean expression request should be recognized"
);
assert.equal(
  shouldTreatAsContinuationFollowUp(currentExpression, previousCafeTurn),
  false,
  "A new expression request must not be pulled into previous cafe/table-7 context"
);
assert.equal(
  detectSupportMode(currentExpression),
  "language",
  "A new expression request should route to language support"
);

assert.equal(
  shouldTreatAsContinuationFollowUp("아까 leave the cafe라고 한 문장을 다시 고쳐줘.", previousCafeTurn),
  true,
  "Explicit reference to a previous sentence may use prior context"
);

assert.equal(
  shouldTreatAsContinuationFollowUp(
    "이건 소스에 나온 사실은 아니고 내가 추가한 설정인데, 메시지를 남긴 남자가 직업이 필요하다는 방향은 괜찮을까?",
    previousCafeTurn
  ),
  false,
  "A source-missing learner idea should be treated as the current idea"
);

const ep1History = [
  { role: "user", text: "Jack이 학생증 때문에 집에 다시 가는 흐름은 어때?" },
  { role: "assistant", text: "EP1에서는 Jack, wallet, student ID, presentation pressure가 중요해요." },
];

assert.equal(
  shouldTreatAsContinuationFollowUp(
    "Anna 이야기에서 메시지를 남긴 사람이 8번가에 사는 남자라고 말하려고.",
    ep1History
  ),
  false,
  "EP1 Jack/student-ID context must not be reused for a new EP2 Anna expression request"
);

assert.ok(
  buildSystemInstruction("korean", "language", true).includes(
    "identify and satisfy the learner's immediate communicative intent"
  ),
  "System prompt should explicitly prioritize immediate communicative intent"
);
assert.ok(
  buildSystemInstruction("korean", "language", false).includes(
    "provide one complete English sentence"
  ),
  "System prompt should allow one complete English sentence"
);

console.log("Context priority regression tests passed: 8 checks");
