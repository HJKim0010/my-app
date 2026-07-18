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

function sentenceLikeKoreanTarget(query: string): boolean {
  const target = extractTranslationTarget(query);
  const koreanChars = target.match(/[\uac00-\ud7a3]/g)?.length ?? 0;

  return (
    koreanChars >= 6 &&
    (/(다|요|어|해|했다|했어|했어요|려고|싶어|싶어요|는데|니까|어서|아서|고)\.?$/.test(target) ||
      /\s/.test(target))
  );
}

function extractTranslationTarget(query: string): string {
  const trimmed = compactText(query);
  const quoted = trimmed.match(/["'“‘](.+?)["'”’]/)?.[1];
  if (quoted) return compactText(quoted);

  const colonTarget = trimmed.match(/[:：]\s*(.+)$/)?.[1];
  if (colonTarget) return compactText(colonTarget);

  return compactText(
    trimmed
      .replace(/영어로\s*(?:어떻게\s*)?(?:말해|표현해|번역해|바꿔|해줘|할까|되나|돼|알려줘)?/gi, " ")
      .replace(/(?:how\s+(?:do|can|should)\s+i\s+say|translate|in english|into english|\-\>\s*english|\-\>\s*영어로)/gi, " ")
      .replace(/[?!.。！？]+$/g, "")
  );
}

export function asksForDirectTranslation(query: string): boolean {
  if (/(영어로|한국어로|번역|영작|어떻게\s*(?:말해|표현|써|쓰|하)|표현해|말하고\s*싶|쓰고\s*싶)/i.test(query)) {
    return true;
  }

  return /(in english|into english|translate|translation|영어로|번역|영작|영어\s*문장|어떻게\s*(?:말해|표현|써|쓰))/i.test(
    query
  );
}

export function asksForFullSentenceTranslation(query: string): boolean {
  if (!asksForDirectTranslation(query)) {
    return false;
  }

  return (
    sentenceLikeKoreanTarget(query) ||
    /(translate this sentence|translate the sentence|whole sentence|full sentence|이\s*문장|그\s*문장|한\s*문장|문장\s*전체)/i.test(
      query
    )
  );
}

function hasFeedbackSignal(query: string): boolean {
  const q = normalize(query);
  if (includesAny(q, ["문법", "어색", "논리", "자연", "피드백", "확인", "교정", "수정", "고쳐", "봐줘", "맞아"])) {
    return true;
  }

  return includesAny(q, [
    "feedback",
    "proofread",
    "check",
    "review",
    "correct",
    "fix",
    "edit",
    "natural",
    "awkward",
    "make sense",
    "logical",
    "coherent",
    "문법",
    "첨삭",
    "교정",
    "고쳐",
    "수정",
    "자연스럽",
    "어색",
    "피드백",
    "봐줘",
    "검토",
    "확인",
    "흐름",
    "논리",
    "괜찮",
    "말이 돼",
  ]);
}

function detectRequestedAction(query: string): RequestedAction {
  const q = normalize(query);

  if (includesAny(q, ["점수", "채점", "평가", "몇 점", "등급"])) return "score_evaluate";
  if (hasFeedbackSignal(query)) return "check";
  if (asksForDirectTranslation(query)) return "translate";
  if (includesAny(q, ["요약", "줄거리", "원문", "전체 이야기", "사건 순서", "무슨 내용", "무슨 뜻"])) {
    return "explain";
  }
  if (includesAny(q, ["구성", "구조", "순서", "흐름", "정리", "논리"])) return "organize";
  if (includesAny(q, ["아이디어", "전개", "다음 사건", "어떻게 이어", "가능한", "제안", "브레인스토밍"])) {
    return "brainstorm";
  }
  if (
    includesAny(q, ["전체 다시 써", "전체 고쳐", "다시 작성", "리라이팅"]) ||
    /(초안|draft|내 글|글 전체|전체).*(다시\s*써|고쳐|수정|rewrite|모범\s*답안처럼)/i.test(q)
  ) {
    return "rewrite";
  }
  if (includesAny(q, ["써줘", "작성해", "완성해", "만들어줘", "200단어", "120단어", "문단 써"])) {
    return "generate";
  }

  if (includesAny(q, ["rubric", "score", "band", "grade", "evaluate", "점수", "채점", "평가", "몇 점"])) {
    return "score_evaluate";
  }
  if (hasFeedbackSignal(query)) return "check";
  if (asksForDirectTranslation(query)) return "translate";
  if (
    includesAny(q, [
      "summarize",
      "summary",
      "recap",
      "source recap",
      "whole story",
      "entire story",
      "original story",
      "story sequence",
      "order of events",
      "요약",
      "줄거리",
      "원래 이야기",
      "원문",
      "전체 이야기",
    ])
  ) {
    return "explain";
  }
  if (includesAny(q, ["organize", "outline", "structure", "sequence", "flow", "구성", "구조", "순서", "정리"])) {
    return "organize";
  }
  if (includesAny(q, ["idea", "brainstorm", "suggest", "possible", "what if", "아이디어", "전개", "설정", "어때", "어떨까", "제안"])) {
    return "brainstorm";
  }
  if (includesAny(q, ["rewrite my whole", "rewrite the whole", "다시 써", "전체 고쳐", "전체 수정"])) {
    return "rewrite";
  }
  if (includesAny(q, ["write", "generate", "make", "complete", "finish", "써줘", "작성", "완성", "만들어"])) {
    return "generate";
  }
  if (includesAny(q, ["what does", "meaning", "explain", "understand", "무슨 뜻", "설명", "이해", "뭐야"])) {
    return "explain";
  }

  return "unknown";
}

function detectTargetScope(query: string): TargetScope {
  const q = normalize(query);

  if (includesAny(q, ["전체 초안", "글 전체", "전체 글", "전체 다시", "전부 고쳐"])) {
    return "whole_draft";
  }
  if (includesAny(q, ["전체 답안", "전체 이어쓰기", "완성 답안", "모범 답안", "샘플 답안", "200단어", "120단어", "350단어"])) {
    return "whole_answer";
  }
  if (includesAny(q, ["문단", "단락"])) return "paragraph";
  if (includesAny(q, ["여러 문장", "몇 문장"])) return "multiple_sentences";
  if (includesAny(q, ["문장"])) return "clause_sentence";
  if (asksForDirectTranslation(query)) return asksForFullSentenceTranslation(query) ? "clause_sentence" : "phrase";
  if (includesAny(q, ["단어"])) return "word";
  if (includesAny(q, ["표현", "구"])) return "phrase";

  if (includesAny(q, ["whole draft", "entire draft", "everything in my draft", "초안 전체", "글 전체", "전체 글", "전체 고쳐"])) {
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
      "원문 전체",
      "소스 전체",
      "원래 이야기 전체",
      "전체 이어쓰기",
      "이어쓰기 전체",
      "모범 답안",
      "완성 답안",
    ])
  ) {
    return "whole_answer";
  }
  if (includesAny(q, ["paragraph", "문단", "단락"])) return "paragraph";
  if (includesAny(q, ["several sentences", "multiple sentences", "여러 문장", "몇 문장"])) return "multiple_sentences";
  if (includesAny(q, ["sentence", "문장", "한 문장"])) return "clause_sentence";
  if (asksForDirectTranslation(query)) return asksForFullSentenceTranslation(query) ? "clause_sentence" : "phrase";
  if (includesAny(q, ["word", "단어"])) return "word";
  if (includesAny(q, ["phrase", "expression", "collocation", "표현", "어휘"])) return "phrase";

  return "unknown";
}

function detectOutputForm(query: string, action: RequestedAction, scope: TargetScope): OutputForm {
  const q = normalize(query);

  if (action === "score_evaluate") return "score";
  if (scope === "whole_answer") return "full_answer";
  if (scope === "paragraph") return "paragraph";
  if (
    scope === "clause_sentence" ||
    includesAny(q, ["as a sentence", "write a sentence", "문장으로", "한 문장", "영어 문장"])
  ) {
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

  if (includesAny(q, ["날씨", "뉴스", "주식", "레시피", "여행"])) {
    return "task_unrelated";
  }
  if (includesAny(q, ["이야기", "원문", "자료", "작문", "이어쓰기", "초안", "문장", "표현", "과제"])) {
    return "task_related";
  }

  if (includesAny(q, ["weather", "news", "stock", "recipe", "travel plan", "뉴스", "주식", "레시피"])) {
    return "task_unrelated";
  }
  if (includesAny(q, ["story", "source", "continuation", "writing", "draft", "이야기", "원문", "자료", "작문", "이어쓰기"])) {
    return "task_related";
  }

  return "unclear";
}

function isLanguageFeedbackOrWritingSupportQuery(query: string): boolean {
  const q = normalize(query);
  return (
    asksForDirectTranslation(query) ||
    hasFeedbackSignal(query) ||
    includesAny(q, ["sentence", "phrase", "expression", "grammar", "vocabulary", "문장", "표현", "문법", "단어", "어휘"])
  );
}

export function detectSupportModeLabel(query: string): SupportModeLabel {
  const action = detectRequestedAction(query);
  const q = normalize(query);

  if (action === "score_evaluate") return "restricted";
  if (action === "check") return "feedback_checking";
  if (includesAny(q, ["몇 단어", "시간", "사전", "제출", "어디에 작성", "어떻게 제출", "챗봇에게", "사용해도 돼", "과제 설명"])) {
    return "procedural";
  }
  if (action === "translate" || includesAny(q, ["word", "phrase", "expression", "vocabulary", "단어", "표현", "어휘"])) {
    return "vocabulary_expression";
  }
  if (action === "organize") return "organization";
  if (action === "brainstorm") return "idea_generation";
  if (action === "explain") return "comprehension";
  if (includesAny(q, ["how to use", "button", "category", "start", "버튼", "사용", "시작"])) {
    return "procedural";
  }

  return "other";
}

export function detectFeedbackTarget(query: string): FeedbackTarget {
  const q = normalize(query);

  if (includesAny(q, ["원문과", "이야기와", "자료와", "연결", "맞는지", "모순"])) {
    return "source_connection";
  }
  if (includesAny(q, ["단서", "힌트"])) return "source_use";
  if (includesAny(q, ["개연성", "현실적", "말이 돼", "자연스러", "논리"])) {
    return "content_plausibility";
  }
  if (includesAny(q, ["흐름", "순서", "구성", "조직"])) {
    return "organization_coherence";
  }
  if (includesAny(q, ["문법", "표현", "문장", "어색", "단어"])) {
    return "language";
  }
  if (includesAny(q, ["과제", "조건", "결말", "완성"])) return "task_completion";

  if (includesAny(q, ["source connection", "connect", "match the story", "원래 이야기", "자료", "원문", "연결", "이어지", "모순"])) {
    return "source_connection";
  }
  if (includesAny(q, ["clue", "hint", "단서", "힌트"])) return "source_use";
  if (includesAny(q, ["plausible", "realistic", "make sense", "개연성", "현실성", "말이 돼", "자연스럽"])) {
    return "content_plausibility";
  }
  if (includesAny(q, ["flow", "sequence", "organization", "order", "흐름", "순서", "구성"])) {
    return "organization_coherence";
  }
  if (includesAny(q, ["grammar", "expression", "sentence", "language", "문법", "표현", "문장", "어색"])) {
    return "language";
  }
  if (includesAny(q, ["complete", "task", "ending", "마무리", "완성", "과제"])) return "task_completion";

  return hasFeedbackSignal(query) ? "general" : null;
}

export function analyzeQueryScope(query: string): ScopeDecision {
  const requestedAction = detectRequestedAction(query);
  const targetScope = detectTargetScope(query);
  const outputForm = detectOutputForm(query, requestedAction, targetScope);
  const taskRelevance = detectTaskRelevance(query);
  const feedbackTarget = detectFeedbackTarget(query);
  let reason: RestrictionReason | null = null;
  const asksForKoreanFullGeneration =
    /(다음\s*이야기|이어쓰기|계속되는\s*이야기|continuation|story).*(?:써줘|작성|완성|200\s*단어|120\s*단어|350\s*단어|문단)|(?:200|120|350)\s*단어.*(?:써줘|작성|완성)|완성된\s*(?:답안|이야기|문단)|모범\s*답안/i.test(
      query
    );

  const asksForFullGeneration =
    /(next\s*paragraph|full\s*continuation|whole\s*continuation|model\s*answer|sample\s*answer|다음\s*문단|문단.*(?:써|작성|만들)|4\s*문장|네\s*문장|전체\s*이어쓰기|이어쓰기\s*전체|모범\s*답안|완성\s*답안)/i.test(
      query
    );
  if (
    requestedAction === "rewrite" &&
    (targetScope === "whole_draft" || targetScope === "whole_answer" || targetScope === "paragraph")
  ) {
    reason = "draft_rewrite";
  } else if (
    asksForKoreanFullGeneration ||
    asksForFullGeneration ||
    (requestedAction === "generate" &&
      (targetScope === "whole_answer" ||
        targetScope === "paragraph" ||
        outputForm === "full_answer" ||
        outputForm === "paragraph"))
  ) {
    reason = "sentence_generation";
  } else if (requestedAction === "translate" && targetScope === "paragraph") {
    reason = "draft_rewrite";
  } else if (requestedAction === "score_evaluate") {
    reason = "scoring_evaluation";
  } else if (taskRelevance === "task_unrelated" && !isLanguageFeedbackOrWritingSupportQuery(query)) {
    reason = "outside_content";
  }

  return {
    queryType: reason ? "restricted" : "allowed",
    reason,
    requestedAction,
    targetScope,
    outputForm,
    taskRelevance,
    detectedSupportMode: reason ? "restricted" : detectSupportModeLabel(query),
    feedbackTarget,
  };
}

export function detectRestrictionReason(query: string): RestrictionReason | null {
  return analyzeQueryScope(query).reason;
}

export function classifyQuery(query: string): QueryType {
  return analyzeQueryScope(query).queryType;
}
