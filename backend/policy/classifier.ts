export type QueryType = "allowed" | "restricted";

export type RestrictionReason =
  | "sentence_generation"
  | "draft_rewrite"
  | "outside_content"
  | "direct_translation"
  | "scoring_evaluation";

export type RequestedAction =
  | "explain"
  | "suggest"
  | "brainstorm"
  | "organize"
  | "check"
  | "translate"
  | "generate"
  | "rewrite"
  | "score_evaluate"
  | "unknown";

export type TargetScope =
  | "word"
  | "phrase"
  | "clause_sentence"
  | "multiple_sentences"
  | "paragraph"
  | "whole_draft"
  | "whole_answer"
  | "unknown";

export type OutputForm =
  | "explanation"
  | "options"
  | "outline"
  | "feedback"
  | "complete_sentence"
  | "paragraph"
  | "full_answer"
  | "score"
  | "unknown";

export type SupportModeLabel =
  | "comprehension"
  | "idea_generation"
  | "organization"
  | "vocabulary_expression"
  | "feedback_checking"
  | "procedural"
  | "restricted"
  | "other";

export type FeedbackTarget =
  | "source_connection"
  | "source_use"
  | "content_plausibility"
  | "organization_coherence"
  | "language"
  | "task_completion"
  | "general"
  | null;

export type ScopeDecision = {
  queryType: QueryType;
  reason: RestrictionReason | null;
  requestedAction: RequestedAction;
  targetScope: TargetScope;
  outputForm: OutputForm;
  taskRelevance: "task_related" | "task_unrelated" | "unclear";
  detectedSupportMode: SupportModeLabel;
  feedbackTarget: FeedbackTarget;
};

const HANGUL = /[\uac00-\ud7a3]/;

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalize(text: string): string {
  return compactText(text).toLowerCase();
}

function includesAny(text: string, patterns: readonly (string | RegExp)[]): boolean {
  return patterns.some((pattern) =>
    typeof pattern === "string" ? text.includes(pattern) : pattern.test(text)
  );
}

function hasFeedbackSignal(query: string): boolean {
  const normalized = normalize(query);

  return includesAny(normalized, [
    "feedback",
    "check",
    "review",
    "diagnose",
    "natural",
    "awkward",
    "make sense",
    "logical",
    "logic",
    "coherent",
    "connected",
    "connection",
    "fit the story",
    "match the story",
    "matches the source",
    "story connection",
    "source connection",
    "does this idea work",
    "is this idea okay",
    "is my idea okay",
    "is this okay",
    "what is wrong",
    "anything wrong",
    "problem with",
    /피드백|확인|검토|점검|봐\s*줘|봐줄|어색|자연스|자연스럽|논리|말이\s*되|말\s*돼|괜찮|맞아|맞나요|맞는지|이어지|연결|개연성|현실성|이상한\s*부분|문제\s*(있는|있나|있어)|고칠\s*부분|수정할\s*부분|부자연/,
  ]);
}

function stripRequestWords(text: string): string {
  return compactText(
    text
      .replace(/please|pls|can you|could you|would you|help me|tell me|give me/gi, " ")
      .replace(/영어로|번역해줘|번역|뭐라고 해|뭐라고|어떻게 표현해|표현|알려줘|해줘|바꿔줘|주세요|줘/g, " ")
      .replace(/[?!.]/g, " ")
  );
}

function extractKoreanTranslationTarget(query: string): string {
  const cleaned = compactText(query);
  const colonTarget = cleaned.match(/[:：]\s*(.+)$/)?.[1];
  if (colonTarget && HANGUL.test(colonTarget)) {
    return compactText(colonTarget);
  }

  const beforeEnglishMarker = cleaned.split(/영어로|in english|into english/i)[0]?.trim() || cleaned;
  const objectMatch = beforeEnglishMarker.match(/(.+?)(?:을|를)\s*(?:영어로|뭐라고|어떻게|번역)/);
  if (objectMatch?.[1]) {
    return compactText(objectMatch[1]);
  }

  return stripRequestWords(beforeEnglishMarker);
}

function looksLikeKoreanClauseOrSentence(text: string): boolean {
  const target = extractKoreanTranslationTarget(text);
  const koreanChars = target.match(/[\uac00-\ud7a3]/g)?.length ?? 0;

  if (koreanChars < 5) {
    return false;
  }

  const hasSentenceEnding =
    /(다|요|어요|아요|했다|했다가|였다|였다가|한다|했다는|있다|없다)[.!?。！？]?$/u.test(
      target
    );
  const hasSubjectPredicateShape =
    /(나는|내가|그는|그녀는|그가|그들이|사람들이|주인공이|학생이|경찰이|사장이|친구가).+(했다|한다|갔다|왔다|있다|없다|느꼈|생각했|말했|보았|봤|발견했|잃어버렸|늦었|두근)/u.test(
      target
    );
  const hasClauseConnector = /(해서|하고|지만|는데|으면|라면|때문에|느라|려고|다가|어서|아서)/u.test(target);

  return hasSentenceEnding || hasSubjectPredicateShape || hasClauseConnector;
}

function looksLikePhraseTranslation(query: string): boolean {
  const target = extractKoreanTranslationTarget(query);

  if (!target || !HANGUL.test(target)) {
    return false;
  }

  if (looksLikeKoreanClauseOrSentence(query)) {
    return false;
  }

  return target.length <= 28 || /(하다|되다|거리다|스럽다)$/u.test(target);
}

export function asksForDirectTranslation(query: string): boolean {
  return /(in english|into english|translate|translation|영어로|번역|뭐라고 해|어떻게 표현)/i.test(
    query
  );
}

export function asksForFullSentenceTranslation(query: string): boolean {
  const q = normalize(query);

  if (!asksForDirectTranslation(query)) {
    return false;
  }

  if (looksLikePhraseTranslation(query)) {
    return false;
  }

  return (
    looksLikeKoreanClauseOrSentence(query) ||
    includesAny(q, [
      "translate this sentence",
      "translate the sentence",
      "translate this paragraph",
      "whole sentence",
      "full sentence",
      "문장 전체",
      "전체 문장",
      "이 문장",
      "그 문장",
      "완성해서",
    ])
  );
}

function detectRequestedAction(query: string): RequestedAction {
  const q = normalize(query);

  if (includesAny(q, ["rubric", "score", "band", "grade", "evaluate", "몇 점", "점수", "채점", "평가"])) {
    return "score_evaluate";
  }

  if (asksForDirectTranslation(query)) {
    return "translate";
  }

  if (
    includesAny(q, [
      "rewrite my whole",
      "rewrite the whole",
      "whole draft",
      "entire draft",
      "correct everything",
      /전체\s*(초안|글|문단)|글\s*전체|초안\s*전체|다시\s*써|고쳐\s*써|전부\s*고쳐|전체.*수정/,
    ])
  ) {
    return "rewrite";
  }

  if (hasFeedbackSignal(query)) {
    return "check";
  }

  if (
    includesAny(q, [
      "write the next paragraph",
      "write the next part",
      "write the whole",
      "model answer",
      "sample answer",
      "full answer",
      "next paragraph",
      "as a sentence",
      "write a sentence",
      "write it as a sentence",
      "다음 문단",
      "전체 이어쓰기",
      "모범 답안",
      "완성 답안",
      "문단을 써",
      "문장으로 써",
      "대신 써",
    ])
  ) {
    return "generate";
  }

  if (
    includesAny(q, [
      "rewrite my whole",
      "rewrite the whole",
      "whole draft",
      "entire draft",
      "correct everything",
      "전체 초안",
      "전체 글",
      "글 전체",
      "다 고쳐",
      "다시 써",
    ])
  ) {
    return "rewrite";
  }

  if (includesAny(q, ["check", "feedback", "natural", "make sense", "awkward", "문제", "자연스", "어색", "말이 돼", "괜찮"])) {
    return "check";
  }

  if (includesAny(q, ["organize", "outline", "structure", "sequence", "flow", "순서", "구성", "흐름", "개요"])) {
    return "organize";
  }

  if (includesAny(q, ["idea", "brainstorm", "suggest", "possible", "next event", "아이디어", "사건", "전개", "제안"])) {
    return "brainstorm";
  }

  if (
    includesAny(q, [
      "rewrite",
      "revise",
      "polish",
      "edit",
      "fix",
      "correct",
      "고쳐",
      "수정",
      "다듬",
      "자연스럽게 다시",
      "바꿔줘",
    ])
  ) {
    return "rewrite";
  }

  if (
    includesAny(q, [
      "write",
      "generate",
      "make",
      "complete",
      "finish",
      "써줘",
      "작성",
      "완성",
      "대신",
      "답안",
    ])
  ) {
    return "generate";
  }

  if (includesAny(q, ["what does", "meaning", "explain", "understand", "무슨 뜻", "설명", "이해"])) {
    return "explain";
  }

  return "unknown";
}

function detectTargetScope(query: string): TargetScope {
  const q = normalize(query);

  if (includesAny(q, ["whole draft", "whole continuation", "entire draft", "everything", "전체 초안", "전체 글", "글 전체", "다 고쳐"])) {
    return "whole_draft";
  }

  if (
    includesAny(q, [
      "whole answer",
      "full answer",
      "full continuation",
      "whole continuation",
      "model answer",
      "sample answer",
      "high-scoring answer",
      "완성 답안",
      "모범 답안",
      "고득점 답안",
      "전체 이어쓰기",
      "이어쓰기 전체",
    ])
  ) {
    return "whole_answer";
  }

  if (includesAny(q, ["paragraph", "문단"])) {
    return "paragraph";
  }

  if (includesAny(q, ["several sentences", "multiple sentences", "몇 문장", "여러 문장"])) {
    return "multiple_sentences";
  }

  if (includesAny(q, ["sentence", "문장"])) {
    return "clause_sentence";
  }

  if (asksForDirectTranslation(query)) {
    if (asksForFullSentenceTranslation(query)) return "clause_sentence";
    if (looksLikePhraseTranslation(query)) return "phrase";
  }

  if (includesAny(q, ["word", "단어"])) return "word";
  if (includesAny(q, ["phrase", "expression", "collocation", "표현", "구"])) return "phrase";

  return "unknown";
}

function detectOutputForm(query: string, action: RequestedAction, scope: TargetScope): OutputForm {
  const q = normalize(query);

  if (action === "score_evaluate" || includesAny(q, ["몇 점", "score", "band", "grade"])) return "score";
  if (scope === "whole_answer") return "full_answer";
  if (scope === "paragraph") return "paragraph";
  if (action === "generate" && (scope === "clause_sentence" || /문장으로\s*써|as a sentence/i.test(query))) {
    return "complete_sentence";
  }
  if (action === "check") return "feedback";
  if (action === "organize") return "outline";
  if (action === "brainstorm") return "options";
  if (action === "explain") return "explanation";

  return "unknown";
}

function detectTaskRelevance(query: string): ScopeDecision["taskRelevance"] {
  const q = normalize(query);

  if (
    includesAny(q, [
      "realistic",
      "real life",
      "normally do",
      "make sense in real life",
      "현실적으로",
      "실제라면",
      "현실에서는",
      "말이 돼",
      "자연스러",
    ])
  ) {
    return "task_related";
  }

  if (
    includesAny(q, [
      "weather",
      "news",
      "stock",
      "celebrity",
      "recipe",
      "travel plan",
      "unrelated",
      "일반 상식",
      "뉴스",
      "주식",
      "날씨",
      "레시피",
    ])
  ) {
    return "task_unrelated";
  }

  return "unclear";
}

export function detectSupportModeLabel(query: string): SupportModeLabel {
  const action = detectRequestedAction(query);
  const q = normalize(query);

  if (action === "score_evaluate") return "restricted";
  if (action === "check") return "feedback_checking";
  if (action === "translate" || includesAny(q, ["word", "phrase", "expression", "vocabulary", "단어", "표현"])) {
    return "vocabulary_expression";
  }
  if (action === "organize") return "organization";
  if (action === "brainstorm" || includesAny(q, ["next event", "idea", "아이디어", "사건", "전개"])) {
    return "idea_generation";
  }
  if (action === "explain") return "comprehension";
  if (includesAny(q, [/한국어로\s*질문|영어로\s*질문|질문해도\s*돼|질문해도\s*되|어떻게\s*사용|사용\s*방법|시작|버튼/])) {
    return "procedural";
  }
  if (includesAny(q, ["how to use", "button", "category", "start", "버튼", "사용", "시작"])) {
    return "procedural";
  }

  return "other";
}

export function detectFeedbackTarget(query: string): FeedbackTarget {
  const q = normalize(query);

  if (includesAny(q, ["source connection", "connect", "원래 이야기", "연결"])) return "source_connection";
  if (includesAny(q, ["clue", "hint", "단서"])) return "source_use";
  if (includesAny(q, ["plausible", "realistic", "make sense", "말이 돼", "현실", "자연스러"])) {
    return "content_plausibility";
  }
  if (includesAny(q, ["flow", "sequence", "organization", "order", "흐름", "순서", "구성"])) {
    return "organization_coherence";
  }
  if (includesAny(q, ["grammar", "expression", "sentence", "language", "문법", "표현", "문장", "어색"])) {
    return "language";
  }
  if (includesAny(q, ["complete", "task", "ending", "마무리", "완성", "과제"])) return "task_completion";

  return null;
}

function detectFeedbackTargetV2(query: string): FeedbackTarget {
  const q = normalize(query);

  if (
    includesAny(q, [
      "source connection",
      "connected",
      "match the story",
      "matches the source",
      /원래\s*이야기|원문|자료|source|story.*connect|connect.*story|연결|이어지/,
    ])
  ) return "source_connection";
  if (includesAny(q, ["clue", "hint", /단서|힌트/])) return "source_use";
  if (includesAny(q, ["plausible", "realistic", "make sense", /말이\s*되|말\s*돼|개연성|현실성|자연스/])) {
    return "content_plausibility";
  }
  if (includesAny(q, ["flow", "sequence", "organization", "order", /흐름|순서|구성|전개/])) {
    return "organization_coherence";
  }
  if (includesAny(q, ["grammar", "expression", "sentence", "language", /문법|표현|문장|어색|부자연|고칠\s*부분/])) {
    return "language";
  }
  if (includesAny(q, ["complete", "task", "ending", /마무리|완성|과제/])) return "task_completion";

  return detectFeedbackTarget(query) ?? (hasFeedbackSignal(query) ? "general" : null);
}

export function analyzeQueryScope(query: string): ScopeDecision {
  const requestedAction = detectRequestedAction(query);
  const targetScope = detectTargetScope(query);
  const outputForm = detectOutputForm(query, requestedAction, targetScope);
  const taskRelevance = detectTaskRelevance(query);
  const detectedSupportMode = detectSupportModeLabel(query);
  const feedbackTarget = detectFeedbackTargetV2(query);

  const asksForCompleteSentence =
    /as a sentence|write .*sentence|문장으로\s*써|문장.*써줘|문장.*작성/i.test(query);
  const asksForFullGeneration =
    /next paragraph|full continuation|whole continuation|model answer|sample answer|다음 문단|전체 이어쓰기|모범 답안|완성 답안/i.test(
      query
    );

  let reason: RestrictionReason | null = null;

  if (
    requestedAction === "generate" &&
    (targetScope === "whole_answer" ||
      targetScope === "paragraph" ||
      outputForm === "full_answer" ||
      outputForm === "complete_sentence" ||
      outputForm === "paragraph" ||
      asksForCompleteSentence ||
      asksForFullGeneration)
  ) {
    reason = "sentence_generation";
  } else if (
    requestedAction === "rewrite" &&
    (targetScope === "whole_draft" ||
      targetScope === "whole_answer" ||
      targetScope === "paragraph" ||
      /whole|entire|everything|전체|다 고쳐|초안|문단/i.test(query))
  ) {
    reason = "draft_rewrite";
  } else if (requestedAction === "translate" && targetScope === "paragraph") {
    reason = "draft_rewrite";
  } else if (asksForFullSentenceTranslation(query)) {
    reason = "direct_translation";
  } else if (requestedAction === "score_evaluate") {
    reason = "scoring_evaluation";
  } else if (taskRelevance === "task_unrelated") {
    reason = "outside_content";
  }

  return {
    queryType: reason ? "restricted" : "allowed",
    reason,
    requestedAction,
    targetScope,
    outputForm,
    taskRelevance,
    detectedSupportMode: reason ? "restricted" : detectedSupportMode,
    feedbackTarget,
  };
}

export function detectRestrictionReason(query: string): RestrictionReason | null {
  return analyzeQueryScope(query).reason;
}

export function classifyQuery(query: string): QueryType {
  return analyzeQueryScope(query).queryType;
}
