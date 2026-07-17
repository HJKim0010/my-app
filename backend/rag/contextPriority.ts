type RecentMessage = {
  role: "user" | "assistant";
  text: string;
};

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalize(text: string): string {
  return compactText(text).toLowerCase();
}

export function looksLikeNewCurrentLanguageIntent(query: string): boolean {
  const normalized = normalize(query);

  if (!normalized || normalized.length < 4) {
    return false;
  }

  return /(in english|into english|translate|translation|how\s+(?:do|can|should)\s+i\s+say|how\s+to\s+say|sentence|phrase|expression|vocabulary|grammar|natural|awkward|영어로|번역|영작|표현|문장|단어|어휘|문법|자연스럽|어색|말하려고|이야기하려고|표현하려고|말하고\s*싶|쓰고\s*싶|넣고\s*싶|이런\s*느낌|이\s*말은|라고\s*쓰고\s*싶)/i.test(
    normalized
  );
}

function looksLikeNewCurrentIdeaIntent(query: string): boolean {
  const normalized = normalize(query);

  if (!normalized || normalized.length < 8) {
    return false;
  }

  return /(my\s+(?:new\s+)?idea|my\s+setting|what\s+if|how\s+about|new\s+idea|new\s+setting|이런\s*설정|이\s*설정|새로운\s*설정|내\s*아이디어|이\s*내용을\s*넣고|여기서\s*이렇게|그다음에는|어때|어떨까|source\s+does\s+not\s+say|not\s+in\s+the\s+source|소스에\s*(?:없는|나온\s*사실)|원문에\s*(?:없는|나온\s*사실)|자료에\s*(?:없는|나온\s*사실)|내가\s*추가한\s*설정)/i.test(
    normalized
  );
}

export function recentDialogueLooksLikeContinuationWork(
  recentMessages: RecentMessage[]
): boolean {
  const recentText = normalize(recentMessages.slice(-6).map((message) => message.text).join(" "));

  return /(next\s+event|continue|continuation|story\s+flow|sequence|idea|clue|note|memo|table\s*7|cafe|leave\s+the\s+cafe|anna|jack|sentence|option|expression|phrase|urgently|desperately|다음\s*사건|다음\s*전개|이어쓰기|흐름|순서|아이디어|단서|쪽지|메시지|7번\s*테이블|테이블\s*7|카페|떠나|안나|애나|잭|문장|표현|선택지|절박)/i.test(
    recentText
  );
}

function explicitlyReferencesPrevious(query: string): boolean {
  const normalized = normalize(query);

  const strongReference =
    /(previous|earlier|above|that\s+(?:sentence|option|answer|one)|the\s+second|the\s+first|아까|방금|전에|위에|이전|그\s*문장|그\s*표현|그\s*답|두\s*번째|첫\s*번째|다시|좀\s*더)/i.test(
      normalized
    );
  const vaguePronoun = /(그거|그건|이거|이건)/i.test(normalized);

  return strongReference || (vaguePronoun && normalized.length <= 80);
}

function looksLikeShortFollowUp(query: string): boolean {
  const normalized = normalize(query);

  if (!normalized || normalized.length > 120) {
    return false;
  }

  return /(then|next|what\s+about|how\s+about|more|again|check|does\s+this\s+work|is\s+this\s+okay|sounds\s+good|that\s+works|그럼|그러면|그다음|다음|더|다시|확인|봐줘|괜찮|잡아\s*줘|잡아줘|그렇게\s*해\s*줘|그걸로\s*할게|어때)/i.test(
    normalized
  );
}

export function shouldTreatAsContinuationFollowUp(
  query: string,
  recentMessages: RecentMessage[]
): boolean {
  if (!recentDialogueLooksLikeContinuationWork(recentMessages)) {
    return false;
  }

  if (looksLikeNewCurrentIdeaIntent(query)) {
    return false;
  }

  if (explicitlyReferencesPrevious(query)) {
    return true;
  }

  if (looksLikeNewCurrentLanguageIntent(query)) {
    return false;
  }

  return looksLikeShortFollowUp(query);
}
