import type { RecentMessage } from "@/backend/rag/conversationMemory";

export type MissingAnswerSlot =
  | "name"
  | "status"
  | "reason"
  | "place"
  | "next"
  | "second"
  | "remaining"
  | "part";

export type IncompleteAnswerRepair = {
  slot: MissingAnswerSlot;
  previousUserText: string;
  previousAssistantText: string;
};

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalize(text: string): string {
  return compactText(text).toLowerCase();
}

function includesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function requestedSlots(text: string): Set<MissingAnswerSlot> {
  const normalized = normalize(text);
  const slots = new Set<MissingAnswerSlot>();

  if (includesAny(normalized, [/(name|who|main\s*character|protagonist|주인공|이름|누구)/i])) {
    slots.add("name");
  }

  if (includesAny(normalized, [/(status|identity|role|job|occupation|student|신분|정체|직업|학생)/i])) {
    slots.add("status");
  }

  if (includesAny(normalized, [/(reason|why|because|이유|왜|뭐때문|무엇때문)/i])) {
    slots.add("reason");
  }

  if (includesAny(normalized, [/(place|where|location|장소|어디)/i])) {
    slots.add("place");
  }

  if (includesAny(normalized, [/(next|after that|then|그다음|다음)/i])) {
    slots.add("next");
  }

  if (includesAny(normalized, [/(second|the second|두\s*번째|2번째)/i])) {
    slots.add("second");
  }

  if (includesAny(normalized, [/(remaining|rest|나머지)/i])) {
    slots.add("remaining");
  }

  if (includesAny(normalized, [/(that part|this part|그\s*부분|이\s*부분)/i])) {
    slots.add("part");
  }

  return slots;
}

function followUpSlot(text: string): MissingAnswerSlot | null {
  const normalized = normalize(text).replace(/[!?.。！？]+$/g, "");

  if (!normalized || normalized.length > 40) {
    return null;
  }

  if (/^(신분|정체|직업|status|identity|role|job)(은|는|이|가)?$/i.test(normalized)) {
    return "status";
  }

  if (/^(이유|왜|reason)(은|는|이|가)?$/i.test(normalized)) {
    return "reason";
  }

  if (/^(장소|어디|where|place)(는|은|이|가)?$/i.test(normalized)) {
    return "place";
  }

  if (/^(그다음|다음|next|then)(은|는|이|가)?$/i.test(normalized)) {
    return "next";
  }

  if (/^(두\s*번째|2번째|second|the second)(는|은|이|가)?$/i.test(normalized)) {
    return "second";
  }

  if (/^(나머지|remaining|rest)(는|은|이|가)?$/i.test(normalized)) {
    return "remaining";
  }

  if (/^(그\s*부분|이\s*부분|that part|this part)$/i.test(normalized)) {
    return "part";
  }

  if (/(안\s*말했잖아|말\s*안\s*했잖아|you\s+did(?:n't| not)\s+answer|you\s+missed)/i.test(normalized)) {
    return "remaining";
  }

  return null;
}

function answeredSlots(text: string): Set<MissingAnswerSlot> {
  const normalized = normalize(text);
  const slots = new Set<MissingAnswerSlot>();

  if (includesAny(normalized, [/(main\s*character|protagonist|주인공|이름|jack|anna)/i])) {
    slots.add("name");
  }

  if (
    includesAny(normalized, [
      /(student|college|university|undergraduate|status|identity|role|job|occupation|학생|대학생|신분|정체|직업)/i,
    ])
  ) {
    slots.add("status");
  }

  if (includesAny(normalized, [/(because|reason|why|이유|때문|왜냐하면)/i])) {
    slots.add("reason");
  }

  if (includesAny(normalized, [/(place|where|location|cafe|subway|classroom|장소|어디|카페|지하철|교실)/i])) {
    slots.add("place");
  }

  if (includesAny(normalized, [/(next|after that|then|그다음|다음)/i])) {
    slots.add("next");
  }

  return slots;
}

export function detectIncompleteAnswerRepair(
  currentQuery: string,
  recentMessages: RecentMessage[]
): IncompleteAnswerRepair | null {
  const slot = followUpSlot(currentQuery);

  if (!slot) {
    return null;
  }

  const latestAssistantIndex = recentMessages
    .map((message, index) => ({ message, index }))
    .reverse()
    .find(({ message }) => message.role === "assistant")?.index;

  if (latestAssistantIndex === undefined) {
    return null;
  }

  const previousUser = recentMessages
    .slice(0, latestAssistantIndex)
    .reverse()
    .find((message) => message.role === "user");
  const previousAssistant = recentMessages[latestAssistantIndex];

  if (!previousUser || !previousAssistant) {
    return null;
  }

  const requested = requestedSlots(previousUser.text);

  if (requested.size < 2 || !requested.has(slot)) {
    return null;
  }

  const answered = answeredSlots(previousAssistant.text);

  if (answered.has(slot)) {
    return null;
  }

  return {
    slot,
    previousUserText: previousUser.text,
    previousAssistantText: previousAssistant.text,
  };
}
