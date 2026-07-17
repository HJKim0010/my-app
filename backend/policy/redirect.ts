import type { RestrictionReason } from "./classifier";

type RedirectLanguage = "english" | "korean";

export type SafeScaffold = {
  boundary: string;
  keyPhrases: string[];
  frame: string;
  guidingQuestion: string;
  safeOptions: string[];
};

function scaffoldFor(
  reason: RestrictionReason,
  language: RedirectLanguage
): SafeScaffold {
  if (language === "english") {
    const boundaryByReason: Record<RestrictionReason, string> = {
      direct_translation:
        "I can help with one sentence or local expression, but not a full paragraph or full continuation.",
      draft_rewrite:
        "I cannot rewrite the whole draft as a model answer, but I can proofread the parts you wrote.",
      outside_content:
        "I should keep the help connected to this continuation-writing task.",
      sentence_generation:
        "I cannot write the whole continuation or paragraph for you, but I can help you build it.",
      scoring_evaluation:
        "I cannot give a score, band, or research-style evaluation, but I can give practical feedback.",
    };

    return {
      boundary: boundaryByReason[reason],
      keyPhrases:
        reason === "sentence_generation"
          ? ["event outline", "causal bridge", "one target sentence"]
          : reason === "draft_rewrite"
            ? ["grammar", "clarity", "flow"]
            : ["specific part", "writing goal"],
      frame:
        reason === "sentence_generation"
          ? "Event outline: 1. ___ 2. ___ 3. ___"
          : "The part I want to improve is ___.",
      guidingQuestion: "Which specific sentence, idea, or connection do you want to work on?",
      safeOptions: ["Ask for one target sentence.", "Ask for feedback on your own draft."],
    };
  }

  const boundaryByReason: Record<RestrictionReason, string> = {
    direct_translation:
      "한 문장이나 짧은 표현은 도와줄 수 있지만, 문단 전체나 이어쓰기 전체를 대신 쓰지는 않을게요.",
    draft_rewrite:
      "초안 전체를 모범답안처럼 다시 쓰지는 못하지만, 네가 쓴 부분의 문법과 흐름은 봐줄 수 있어요.",
    outside_content:
      "이 이어쓰기 과제와 연결되는 범위 안에서 도와줄게요.",
    sentence_generation:
      "이어쓰기 문단 전체를 대신 쓰지는 못하지만, 전개를 만들 수 있게 도와줄 수 있어요.",
    scoring_evaluation:
      "점수나 등급은 줄 수 없지만, 고칠 점과 개선 방법은 말해줄 수 있어요.",
  };

  return {
    boundary: boundaryByReason[reason],
    keyPhrases:
      reason === "sentence_generation"
        ? ["사건 outline", "원인 연결", "한 문장 표현"]
        : reason === "draft_rewrite"
          ? ["문법", "명확성", "흐름"]
          : ["구체적인 부분", "작문 목표"],
    frame:
      reason === "sentence_generation"
        ? "사건 흐름: 1. ___ 2. ___ 3. ___"
        : "고치고 싶은 부분은 ___예요.",
    guidingQuestion: "어떤 문장, 아이디어, 연결 부분을 먼저 다룰까요?",
    safeOptions: ["한 문장 표현을 물어보기", "내 초안에 대한 피드백 받기"],
  };
}

export function buildQueryAwareRedirect(
  reason: RestrictionReason,
  _query: string,
  language: RedirectLanguage = "english"
): SafeScaffold {
  return scaffoldFor(reason, language);
}

export function redirectResponse(
  reason: RestrictionReason,
  language: RedirectLanguage = "english",
  query = ""
): string {
  void query;
  const scaffold = buildQueryAwareRedirect(reason, query, language);

  if (language === "english") {
    return [
      scaffold.boundary,
      reason === "sentence_generation"
        ? "I can give a short event outline, a causal bridge, or one target sentence instead."
        : "Send the specific part you want to work on, and I will help locally.",
    ].join("\n");
  }

  return [
    scaffold.boundary,
    reason === "sentence_generation"
      ? "대신 짧은 사건 흐름, 원인 연결, 또는 목표 문장 하나는 바로 도와줄 수 있어요."
      : "작업하고 싶은 구체적인 부분을 보내면 그 부분부터 도와줄게요.",
  ].join("\n");
}
