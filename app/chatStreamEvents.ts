export type QuickReply = {
  label: string;
  value?: string;
  action?: "send" | "prefill" | "focus";
};

export type ChatApiResponse = {
  ok?: boolean;
  requestId?: string;
  status?: "success" | "redirected" | "incomplete" | "timeout" | "error";
  text: string;
  reason?: string | null;
  quickReplies?: QuickReply[];
};

export type ChatStreamEvent =
  | {
      type: "start";
      requestId: string;
    }
  | {
      type: "delta";
      delta: string;
    }
  | {
      type: "done";
      payload: ChatApiResponse;
    }
  | {
      type: "error";
      payload: ChatApiResponse;
    };

export type ParsedChatStreamChunk = {
  events: ChatStreamEvent[];
  buffer: string;
  malformedLines: string[];
};

export function isQuickReply(value: unknown): value is QuickReply {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  const action = candidate.action;

  return (
    typeof candidate.label === "string" &&
    (candidate.value === undefined || typeof candidate.value === "string") &&
    (action === undefined || action === "send" || action === "prefill" || action === "focus")
  );
}

export function isChatApiResponse(value: unknown): value is ChatApiResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.text === "string" &&
    (candidate.quickReplies === undefined ||
      (Array.isArray(candidate.quickReplies) && candidate.quickReplies.every(isQuickReply)))
  );
}

export function isChatStreamEvent(value: unknown): value is ChatStreamEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  if (candidate.type === "start") {
    return typeof candidate.requestId === "string";
  }

  if (candidate.type === "delta") {
    return typeof candidate.delta === "string";
  }

  if (candidate.type === "done" || candidate.type === "error") {
    return isChatApiResponse(candidate.payload);
  }

  return false;
}

export function parseChatStreamChunk(previousBuffer: string, chunkText: string): ParsedChatStreamChunk {
  const combined = previousBuffer + chunkText;
  const lines = combined.split("\n");
  const nextBuffer = lines.pop() ?? "";
  const events: ChatStreamEvent[] = [];
  const malformedLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;

      if (isChatStreamEvent(parsed)) {
        events.push(parsed);
      } else {
        malformedLines.push(trimmed);
      }
    } catch {
      malformedLines.push(trimmed);
    }
  }

  return {
    events,
    buffer: nextBuffer,
    malformedLines,
  };
}

export function flushChatStreamBuffer(buffer: string): ParsedChatStreamChunk {
  return parseChatStreamChunk("", buffer.endsWith("\n") ? buffer : `${buffer}\n`);
}
