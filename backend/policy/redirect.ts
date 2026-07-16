import type { RestrictionReason } from "./classifier";

type RedirectLanguage = "english" | "korean";

export type SafeScaffold = {
  boundary: string;
  keyPhrases: string[];
  frame: string;
  guidingQuestion: string;
  safeOptions: string[];
};

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function extractQuotedOrTarget(query: string): string {
  const quoted = query.match(/["'“”‘’]([^"'“”‘’]+)["'“”‘’]/)?.[1];
  if (quoted) {
    return compactText(quoted);
  }

  const beforeMarker =
    query.split(/영어로\s*번역|영어로|번역|translate|into english|in english/i)[0] || query;
  const objectMatch = beforeMarker.match(/(.+?)(?:을|를)?\s*(?:영어로|번역|바꿔|고쳐|표현)/);
  return compactText(objectMatch?.[1] || beforeMarker).slice(0, 100);
}

function inferDirectTranslationPhrases(query: string): string[] {
  const target = extractQuotedOrTarget(query).toLowerCase();
  const phrases: string[] = [];

  if (/늦|late/.test(target)) phrases.push("be late / get even later");
  if (/서두|급|hurry|rush/.test(target)) phrases.push("be in a hurry");
  if (/걱정|불안|worried|anxious/.test(target)) phrases.push("be worried / feel anxious");
  if (/심장|heart/.test(target)) phrases.push("heart was beating fast");
  if (/찾|발견|find|found|discover/.test(target)) phrases.push("find / discover");
  if (/지갑|wallet/.test(target)) phrases.push("wallet");
  if (/학생증|student\s*id/.test(target)) phrases.push("student ID");
  if (/집|home/.test(target)) phrases.push("go back home");
  if (/가지러|챙기|bring|get/.test(target)) phrases.push("get / bring");

  return phrases.length ? phrases.slice(0, 4) : ["key action", "reason", "feeling"];
}

function inferKeyPhrases(
  query: string,
  reason: RestrictionReason,
  language: RedirectLanguage
): string[] {
  if (reason === "direct_translation") {
    return inferDirectTranslationPhrases(query);
  }

  if (reason === "draft_rewrite") {
    return language === "korean"
      ? ["흐름", "어색한 표현", "한 문장씩 확인"]
      : ["flow", "awkward expression", "one sentence at a time"];
  }

  if (reason === "scoring_evaluation") {
    return language === "korean"
      ? ["이야기 연결", "전개", "이해하기 어려운 부분"]
      : ["story connection", "development", "unclear part"];
  }

  if (reason === "outside_content") {
    return ["story situation", "character reaction", "plausible event"];
  }

  return language === "korean"
    ? ["단서", "인물의 생각", "다음 행동"]
    : ["clue", "character thought", "next action"];
}

function buildFrame(reason: RestrictionReason, language: RedirectLanguage): string {
  if (reason === "direct_translation") {
    return "He ___ because ___.";
  }

  if (language === "english") {
    switch (reason) {
      case "draft_rewrite":
        return "This part is unclear because ___.";
      case "scoring_evaluation":
        return "One part to check is ___ because ___.";
      case "outside_content":
        return "This could fit the story if ___ causes ___.";
      case "sentence_generation":
      default:
        return "First, ___ happens. Then, the character feels ___.";
    }
  }

  switch (reason) {
    case "draft_rewrite":
      return "이 부분은 ___ 때문에 조금 불분명해요.";
    case "scoring_evaluation":
      return "먼저 확인할 부분은 ___예요. 왜냐하면 ___ 때문이에요.";
    case "outside_content":
      return "이 사건은 ___ 때문에 이야기와 연결될 수 있어요.";
    case "sentence_generation":
    default:
      return "먼저 ___가 일어나고, 그다음 인물은 ___를 생각해요.";
  }
}

function buildBoundary(reason: RestrictionReason, language: RedirectLanguage): string {
  if (language === "english") {
    const boundaryByReason: Record<RestrictionReason, string> = {
      direct_translation:
        "I cannot translate the whole sentence for you, but I can help you build it.",
      draft_rewrite:
        "I cannot rewrite the whole draft, but I can help with one focused part.",
      outside_content:
        "I should stay connected to the story task, but we can check story plausibility.",
      sentence_generation:
        "I cannot write the continuation or paragraph for you, but I can help you plan it.",
      scoring_evaluation:
        "I cannot give a score or band, but I can give limited diagnostic feedback.",
    };

    return boundaryByReason[reason];
  }

  const boundaryByReason: Record<RestrictionReason, string> = {
    direct_translation:
      "문장 전체를 바로 영어로 번역하기보다는, 직접 만들 수 있게 나눠서 도와줄게요.",
    draft_rewrite:
      "전체 초안을 대신 고쳐 쓰기보다는, 한 부분을 골라서 같이 볼게요.",
    outside_content:
      "과제와 연결되지 않는 외부 정보보다는, 이야기 안에서 자연스러운지 확인해 볼게요.",
    sentence_generation:
      "전체 이어쓰기나 문단을 대신 쓰기보다는, 직접 쓸 수 있게 구조를 도와줄게요.",
    scoring_evaluation:
      "점수나 band는 말해줄 수 없지만, 문제가 될 수 있는 부분은 제한적으로 봐줄게요.",
  };

  return boundaryByReason[reason];
}

function buildSafeOptions(language: RedirectLanguage): string[] {
  return language === "english"
    ? ["Share one sentence you try.", "Ask for one phrase or one flow check."]
    : ["네가 시도한 문장 하나를 보내 주세요.", "표현 하나나 흐름 한 부분만 물어봐도 좋아요."];
}

function buildScaffold(
  reason: RestrictionReason,
  query: string,
  language: RedirectLanguage
): SafeScaffold {
  return {
    boundary: buildBoundary(reason, language),
    keyPhrases: inferKeyPhrases(query, reason, language),
    frame: buildFrame(reason, language),
    guidingQuestion:
      language === "english"
        ? "What feeling, reason, or action do you want to add?"
        : "어떤 감정, 이유, 행동을 넣고 싶나요?",
    safeOptions: buildSafeOptions(language),
  };
}

function validateScaffold(scaffold: SafeScaffold): SafeScaffold {
  const safeFrame = scaffold.frame.includes("___") ? scaffold.frame : `${scaffold.frame} ___`;

  return {
    ...scaffold,
    keyPhrases: scaffold.keyPhrases.slice(0, 4).map((phrase) => phrase.replace(/[.!?]+$/g, "")),
    frame: safeFrame,
    safeOptions: scaffold.safeOptions.slice(0, 2),
  };
}

export function buildQueryAwareRedirect(
  reason: RestrictionReason,
  query: string,
  language: RedirectLanguage = "english"
): SafeScaffold {
  return validateScaffold(buildScaffold(reason, query, language));
}

export function redirectResponse(
  reason: RestrictionReason,
  language: RedirectLanguage = "english",
  query = ""
): string {
  const scaffold = buildQueryAwareRedirect(reason, query, language);
  const keyLines = scaffold.keyPhrases.map((phrase) => `- ${phrase}`).join("\n");
  const optionLines = scaffold.safeOptions.map((option) => `- ${option}`).join("\n");

  if (language === "english") {
    return [
      scaffold.boundary,
      "",
      "Useful words or phrases:",
      keyLines,
      "",
      `Frame: ${scaffold.frame}`,
      `Question: ${scaffold.guidingQuestion}`,
      "",
      "Safe next step:",
      optionLines,
    ].join("\n");
  }

  return [
    scaffold.boundary,
    "",
    "쓸 수 있는 단어/표현:",
    keyLines,
    "",
    `문장 틀: ${scaffold.frame}`,
    `생각해 볼 질문: ${scaffold.guidingQuestion}`,
    "",
    "다음에 할 수 있는 것:",
    optionLines,
  ].join("\n");
}
