import type { TaskId } from "./loader";

export type ConversationalOperation =
  | "acknowledge_user_inference"
  | "adjust_assistant_behavior"
  | "continuation_structure";

export type ResponseLanguage = "korean" | "english";

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalize(text: string): string {
  return compactText(text).toLowerCase();
}

export function detectAssistantMetaFeedback(query: string): boolean {
  const normalized = normalize(query);

  if (!normalized || normalized.length > 140) {
    return false;
  }

  return /(too\s*pushy|pushing\s*too\s*much|too\s*long|too\s*wordy|only\s*answer|stop\s*asking|why\s+do\s+you\s+keep|too\s*comprehension|너무\s*푸쉬|너무\s*밀어|재촉|답이\s*너무\s*길|너무\s*길어|내\s*질문에만|묻어본\s*것만|자꾸\s*다른\s*이야기|너무\s*comprehension|이해\s*중심|자꾸\s*되묻|그만\s*물어|문법\s*설명.*필요\s*없|질문한\s*것만|묻지\s*마)/i.test(
    normalized
  );
}

export function buildAssistantMetaFeedbackResponse(
  query: string,
  language: ResponseLanguage
): string {
  const normalized = normalize(query);

  if (language === "english") {
    if (/(too\s*long|too\s*wordy)/i.test(normalized)) {
      return "You're right. My answer was too long. I'll keep the next responses shorter and answer only the needed part.";
    }

    if (/(only\s*answer|why\s+do\s+you\s+keep|stop\s*asking)/i.test(normalized)) {
      return "You're right. I'll answer your exact question first and avoid unnecessary recaps, menus, or follow-up pushes.";
    }

    return "You're right. I pushed too much beyond your question. From now on, I'll answer your question first and suggest next steps only when you ask for them.";
  }

  if (/(답이\s*너무\s*길|너무\s*길어|too\s*long|too\s*wordy)/i.test(normalized)) {
    return "맞아요. 답이 필요 이상으로 길었어요. 앞으로는 필요한 부분만 짧게 답하겠습니다.";
  }

  if (/(내\s*질문에만|묻어본\s*것만|자꾸\s*다른\s*이야기|자꾸\s*되묻|그만\s*물어|질문한\s*것만|묻지\s*마|only\s*answer|stop\s*asking)/i.test(normalized)) {
    return "맞아요. 제가 질문 범위 밖으로 벗어나거나 되묻는 부분이 있었어요. 앞으로는 질문한 내용에 먼저 답하고, 불필요한 설명이나 되묻기는 줄이겠습니다.";
  }

  if (/(comprehension|이해\s*중심)/i.test(normalized)) {
    return "맞아요. 제가 이해 설명 쪽으로 치우쳤어요. 앞으로는 필요한 source 확인만 짧게 하고, 바로 writing support로 연결하겠습니다.";
  }

  return "맞아요. 제가 필요 이상으로 다음 선택을 재촉했어요. 앞으로는 질문한 내용에 먼저 답하고, 다음 단계 제안은 요청할 때만 하겠습니다.";
}

export function detectAcknowledgmentOrInference(query: string): boolean {
  const normalized = normalize(query);

  if (!normalized || normalized.length > 140) {
    return false;
  }

  return /(그러면|그렇다면|그래서|그러니까|아\s*그래서|오케이|ok|okay|then|so).*(중요|긴장|학생|대학생|그렇겠|맞겠|구나|겠네|important|nervous|student)|^(좋아|알겠어|알겠어요|이해했어|이해했어요|okay|ok)[.!?\s]*$/i.test(
    normalized
  );
}

export function buildAcknowledgmentOrInferenceResponse(
  query: string,
  taskId: TaskId,
  language: ResponseLanguage
): string {
  const normalized = normalize(query);

  if (/(발표|presentation|important|중요)/i.test(normalized)) {
    return language === "english"
      ? "Yes. The presentation is important for Jack. The story says his team depends on him, and his final grade and graduation may depend on his decision."
      : "맞아요. Jack에게 발표는 중요해요. 팀이 그의 발표 진행에 기대고 있고, 최종 성적과 졸업에도 영향을 줄 수 있다고 나와요.";
  }

  if (/(긴장|nervous|tense|불안|초조)/i.test(normalized)) {
    return language === "english"
      ? "Yes. That is why he feels tense: he is already late, under presentation pressure, and facing the strange message."
      : "맞아요. 그래서 긴장한 것으로 볼 수 있어요. 이미 늦었고 발표 압박이 있는데, 이상한 메시지까지 받았기 때문이에요.";
  }

  if (/(학생|대학생|student)/i.test(normalized)) {
    if (taskId === "task1") {
      return language === "english"
        ? "Yes. Jack is a student, and the story gives college-like clues: student ID, final team project presentation, final grade, and graduation."
        : "네, 그렇게 볼 수 있어요. Jack은 학생이고, student ID, final team project presentation, final grade, graduation 같은 단서상 대학생으로 볼 수 있어요.";
    }

    return language === "english"
      ? "That is a reasonable inference, but the story does not state Anna's exact status. It shows her after a long study session with a laptop and notebook."
      : "그렇게 추론할 수는 있어요. 다만 원문에서 Anna의 정확한 신분은 확정하지 않고, 긴 공부 후 laptop과 notebook을 챙기는 모습만 보여줘요.";
  }

  return language === "english"
    ? "Yes, that understanding works."
    : "네, 그렇게 이해하면 됩니다.";
}

export function detectContinuationStructureRequest(query: string): boolean {
  const normalized = normalize(query);

  return /(내용|story|continuation|이어쓰기|다음).*(구성|구조|흐름|어떻게\s*구성|structure|organize)|(?:구성|구조|흐름).*(어떻게|좋을까|story|내용|이어쓰기)/i.test(
    normalized
  );
}

export function buildContinuationStructureResponse(
  taskId: TaskId,
  language: ResponseLanguage
): string {
  if (language === "english") {
    return taskId === "task2"
      ? [
          "Plan the continuation after the source ending, not by retelling the whole source.",
          "",
          "- **Decision**: Anna decides whether to take the taped object or step back.",
          "- **Consequence**: her choice creates a problem, clue, or risk.",
          "- **Discovery**: she learns what the object, note, or table 7 might connect to.",
          "- **Resolution**: end with a clear choice or a small reveal, not a full explanation of everything.",
        ].join("\n")
      : [
          "Plan the continuation after the source ending, not by retelling the whole source.",
          "",
          "- **Decision**: Jack decides whether to trust the message or keep going to class.",
          "- **Consequence**: his choice creates pressure, delay, or a new clue.",
          "- **Discovery**: he finds out why the warning may matter.",
          "- **Resolution**: end with a clear result of that decision, without solving everything too quickly.",
        ].join("\n");
  }

  return taskId === "task2"
    ? [
        "원문을 다시 요약하기보다, **원문이 끝난 뒤 Anna의 선택**부터 구성하면 좋아요.",
        "",
        "- **결정**: Anna가 테이블 아래 물건을 가져갈지, 물러설지 정함",
        "- **결과**: 그 선택 때문에 문제, 단서, 위험이 생김",
        "- **발견**: 물건, 쪽지, table 7이 무엇과 연결되는지 조금 드러남",
        "- **마무리**: 모든 걸 설명하기보다 Anna의 다음 선택이나 작은 반전으로 끝냄",
      ].join("\n")
    : [
        "원문을 다시 요약하기보다, **원문이 끝난 뒤 Jack의 선택**부터 구성하면 좋아요.",
        "",
        "- **결정**: Jack이 메시지를 믿을지, 수업으로 갈지 정함",
        "- **결과**: 그 선택 때문에 시간 압박, 지연, 새 단서가 생김",
        "- **발견**: 왜 그 경고가 중요했는지 조금 드러남",
        "- **마무리**: 모든 걸 해결하기보다 선택의 결과가 분명히 보이게 끝냄",
      ].join("\n");
}
