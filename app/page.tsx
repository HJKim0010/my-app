"use client";

import type { ReactNode, TouchEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  flushChatStreamBuffer,
  isChatApiResponse,
  isQuickReply,
  parseChatStreamChunk,
  type ChatApiResponse,
  type QuickReply,
} from "./chatStreamEvents";

type TaskId = "task1" | "task2";
type TaskCondition = "static" | "dynamic";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  quickReplies?: QuickReply[];
  isStreaming?: boolean;
  isError?: boolean;
};

type StoredTranscriptMessage = Pick<ChatMessage, "role" | "text">;

type TaskChatState = {
  sessionId: string;
  sessionStartedAt: number;
  interactionCount: number;
  transcriptSaved: boolean;
  messages: ChatMessage[];
};

const TASK_IDS: TaskId[] = ["task1", "task2"];
const STORAGE_KEY_PREFIX = "writing-assistant-task-state-v6";
const GUIDE_KEY_PREFIX = "writing-assistant-guide-accepted-v6";
const CURRENT_PARTICIPANT_KEY = "writing-assistant-current-participant-v4";
const CHAT_INPUT_BASE_HEIGHT = 55;
const CHAT_INPUT_MAX_HEIGHT = 190;
const CHAT_EXAMPLE_PROMPTS = [
  {
    category: "Comprehension",
    label: "Understand meaning",
    labelKo: "\uC774\uC57C\uAE30 \uC774\uD574",
    en: "What does this part mean?",
    promptKo: "\uC774 \uBD80\uBD84\uC740 \uBB34\uC2A8 \uB73B\uC778\uAC00\uC694?",
    ko: "\uC774 \uBD80\uBD84\uC740 \uBB34\uC2A8 \uB73B\uC778\uAC00\uC694?",
  },
  {
    category: "Ideation",
    label: "Find next ideas",
    labelKo: "\uC544\uC774\uB514\uC5B4 \uC5BB\uAE30",
    en: "Suggest 2 next-event ideas connected to the clue",
    promptKo:
      "\uADF8 \uB2E8\uC11C\uB97C \uC0AC\uC6A9\uD55C \uB2E4\uC74C \uC0AC\uAC74 2\uAC00\uC9C0\uB97C \uC0DD\uAC01\uD574 \uBCFC \uC218 \uC788\uB098\uC694?",
    ko:
      "\uADF8 \uB2E8\uC11C\uB97C \uC0AC\uC6A9\uD55C \uB2E4\uC74C \uC0AC\uAC74 2\uAC00\uC9C0\uB97C \uC0DD\uAC01\uD574 \uBCFC \uC218 \uC788\uB098\uC694?",
  },
  {
    category: "Organization",
    label: "Plan the flow",
    labelKo: "\uAD6C\uC131 \uB3C4\uC6C0",
    en: "Help me organize clue-thought-action",
    promptKo: "\uB2E8\uC11C, \uC0DD\uAC01, \uD589\uB3D9, \uACB0\uACFC\uB97C \uC5B4\uB5A4 \uC21C\uC11C\uB85C \uC815\uB9AC\uD558\uBA74 \uC88B\uC744\uAE4C\uC694?",
    ko:
      "\uB2E8\uC11C, \uC0DD\uAC01, \uD589\uB3D9, \uACB0\uACFC\uB97C \uC5B4\uB5A4 \uC21C\uC11C\uB85C \uC815\uB9AC\uD558\uBA74 \uC88B\uC744\uAE4C\uC694?",
  },
  {
    category: "Language",
    label: "Find a phrase",
    labelKo: "\uD45C\uD604 \uB3C4\uC6C0",
    en: "Help me say this more naturally",
    promptKo: "\uC774 \uB9D0\uC744 \uB354 \uC790\uC5F0\uC2A4\uB7FD\uAC8C \uD45C\uD604\uD558\uB824\uBA74?",
    ko: "\uC774 \uB9D0\uC744 \uB354 \uC790\uC5F0\uC2A4\uB7FD\uAC8C \uD45C\uD604\uD558\uB824\uBA74?",
  },
].map((example) => {
  if (example.category === "Ideation") {
    return {
      ...example,
      promptKo:
        "\uADF8 \uB2E8\uC11C\uB97C \uC0AC\uC6A9\uD55C \uB2E4\uC74C \uC0AC\uAC74 2\uAC00\uC9C0\uB97C \uC0DD\uAC01\uD574 \uBCFC \uC218 \uC788\uB098\uC694?",
      ko:
        "\uADF8 \uB2E8\uC11C\uB97C \uC0AC\uC6A9\uD55C \uB2E4\uC74C \uC0AC\uAC74 2\uAC00\uC9C0\uB97C \uC0DD\uAC01\uD574 \uBCFC \uC218 \uC788\uB098\uC694?",
    };
  }

  if (example.category === "Organization") {
    return {
      ...example,
      ko:
        "\uB2E8\uC11C, \uC0DD\uAC01, \uD589\uB3D9, \uACB0\uACFC\uB97C \uC5B4\uB5A4 \uC21C\uC11C\uB85C \uC815\uB9AC\uD558\uBA74 \uC88B\uC744\uAE4C\uC694?",
    };
  }

  return example;
});

function isExamplePromptText(value: string): boolean {
  return CHAT_EXAMPLE_PROMPTS.some((example) => example.promptKo === value);
}

const CHAT_INPUT_PLACEHOLDER =
  "Example: Which clue should I use to continue the next part logically? / \uC608: \uB2E4\uC74C \uC804\uAC1C\uB97C \uB17C\uB9AC\uC801\uC73C\uB85C \uC774\uC5B4\uAC00\uB824\uBA74 \uC5B4\uB5A4 \uB2E8\uC11C\uB97C \uC774\uC6A9\uD558\uB294 \uAC8C \uC88B\uC744\uAE4C?";

function renderInlineText(text: string, keyPrefix: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${keyPrefix}-strong-${index}`}>{part.slice(2, -2)}</strong>;
    }

    return <span key={`${keyPrefix}-text-${index}`}>{part.replace(/\*\*/g, "")}</span>;
  });
}

type MarkdownListItem = {
  text: string;
  children: MarkdownListItem[];
};

function parseListItems(lines: string[]): MarkdownListItem[] {
  const items: MarkdownListItem[] = [];
  let currentItem: MarkdownListItem | null = null;

  for (const line of lines) {
    const match = line.match(/^(\s*)(?:[-*]|\d+\.)\s+(.+)$/);

    if (!match) {
      continue;
    }

    const indent = match[1].length;
    const item: MarkdownListItem = {
      text: match[2].trim(),
      children: [],
    };

    if (indent > 0 && currentItem) {
      currentItem.children.push(item);
      continue;
    }

    items.push(item);
    currentItem = item;
  }

  return items;
}

function renderListItems(items: MarkdownListItem[], keyPrefix: string): ReactNode {
  return items.map((item, index) => (
    <li key={`${keyPrefix}-item-${index}`}>
      {renderInlineText(item.text, `${keyPrefix}-item-${index}`)}
      {item.children.length > 0 ? (
        <ul>{renderListItems(item.children, `${keyPrefix}-child-${index}`)}</ul>
      ) : null}
    </li>
  ));
}

function renderAssistantText(text: string, isStreaming = false, isError = false): ReactNode {
  const hasText = text.trim().length > 0;

  if (!hasText && isStreaming) {
    return (
      <div className="assistant-markdown assistant-response-streaming">
        <span className="stream-loading" aria-label="Assistant is writing">
          <span />
          <span />
          <span />
        </span>
      </div>
    );
  }

  if (!hasText) {
    return null;
  }

  const lines = text.split("\n");
  const nodes: ReactNode[] = [];
  let index = 0;

  const isListLine = (line: string) => /^\s*(?:[-*]|\d+\.)\s+/.test(line);
  const isOrderedListLine = (line: string) => /^\s*\d+\.\s+/.test(line);
  const isHeadingLine = (line: string) => /^#{1,6}\s*/.test(line.trim());
  const isQuoteLine = (line: string) => line.trim().startsWith(">");
  const nextNonEmptyLine = (startIndex: number) => {
    for (let lineIndex = startIndex; lineIndex < lines.length; lineIndex += 1) {
      if (lines[lineIndex].trim()) {
        return lines[lineIndex];
      }
    }

    return "";
  };

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (isHeadingLine(line)) {
      nodes.push(
        <h3 key={`assistant-heading-${index}`}>
          {renderInlineText(trimmed.replace(/^#{1,6}\s*/, ""), `heading-${index}`)}
        </h3>
      );
      index += 1;
      continue;
    }

    if (isQuoteLine(line)) {
      const quoteLines: string[] = [];

      while (index < lines.length && isQuoteLine(lines[index])) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }

      nodes.push(
        <blockquote key={`assistant-quote-${index}`}>
          <p>{renderInlineText(quoteLines.join(" "), `quote-${index}`)}</p>
        </blockquote>
      );
      continue;
    }

    if (isListLine(line)) {
      const listLines: string[] = [];
      const ordered = isOrderedListLine(line);

      while (index < lines.length) {
        const currentLine = lines[index];

        if (!currentLine.trim()) {
          const nextLine = nextNonEmptyLine(index + 1);

          if (nextLine && isListLine(nextLine) && isOrderedListLine(nextLine) === ordered) {
            index += 1;
            continue;
          }

          break;
        }

        if (!isListLine(currentLine)) {
          break;
        }

        listLines.push(currentLine);
        index += 1;
      }

      nodes.push(
        ordered ? (
          <ol key={`assistant-ordered-list-${index}`}>
            {renderListItems(parseListItems(listLines), `ol-${index}`)}
          </ol>
        ) : (
          <ul key={`assistant-list-${index}`}>
            {renderListItems(parseListItems(listLines), `ul-${index}`)}
          </ul>
        )
      );
      continue;
    }

    const paragraphLines: string[] = [];

    while (index < lines.length) {
      const currentLine = lines[index];

      if (
        !currentLine.trim() ||
        isHeadingLine(currentLine) ||
        isQuoteLine(currentLine) ||
        isListLine(currentLine)
      ) {
        break;
      }

      paragraphLines.push(currentLine.trim());
      index += 1;
    }

    nodes.push(
      <p key={`assistant-paragraph-${index}`}>
        {renderInlineText(paragraphLines.join(" "), `paragraph-${index}`)}
      </p>
    );
  }

  return (
    <div
      className={
        isError
          ? "assistant-markdown assistant-response-error"
          : "assistant-markdown"
      }
    >
      {nodes}
      {isStreaming ? <span className="stream-cursor" aria-hidden="true" /> : null}
    </div>
  );
}

const KO = {
  intro:
    "\uC774 \uCC57\uBD07\uC740 \uAE00\uC744 \uB300\uC2E0 \uC368\uC8FC\uB294 \uB3C4\uAD6C\uAC00 \uC544\uB2D9\uB2C8\uB2E4. \uC601\uC0C1\uC774\uB098 \uC790\uB8CC \uC774\uD6C4\uC758 \uC774\uC57C\uAE30 \uC911\uAC04-\uD6C4\uBC18\uBD80\uB97C \uC5EC\uB7EC\uBD84\uC774 \uC9C1\uC811 \uC774\uC5B4 \uC4F8 \uC218 \uC788\uB3C4\uB85D, \uC774\uD574, \uC544\uC774\uB514\uC5B4, \uAD6C\uC131, \uC5B8\uC5B4 \uD45C\uD604\uC744 \uB3D5\uB294 \uB3C4\uAD6C\uC785\uB2C8\uB2E4.",
  support:
    "AI\uB294 \uC0DD\uAC01\uC744 \uB3D5\uACE0, \uC0C8 \uC0AC\uAC74\uACFC \uACB0\uB9D0\uC740 \uC5EC\uB7EC\uBD84\uC774 \uC9C1\uC811 \uC791\uC131\uD574\uC57C \uD569\uB2C8\uB2E4.",
  languageTitle: "\uC0AC\uC6A9 \uAC00\uB2A5 \uC5B8\uC5B4",
  allowedTitle: "\uC774\uB807\uAC8C \uC0AC\uC6A9\uD558\uC138\uC694",
  restrictedTitle: "\uC774\uB807\uAC8C \uC0AC\uC6A9\uD558\uBA74 \uC548 \uB429\uB2C8\uB2E4",
  goodTitle: "\uC88B\uC740 \uC0AC\uC6A9 vs \uC798\uBABB\uB41C \uC0AC\uC6A9",
  wrongUse: "\uC798\uBABB\uB41C \uC0AC\uC6A9",
  betterUse: "\uB354 \uC88B\uC740 \uC0AC\uC6A9",
  rulesTitle: "\uC911\uC694\uD55C \uADDC\uCE59",
  q1: "\uC774 \uBD80\uBD84\uC740 \uBB34\uC2A8 \uB73B\uC778\uAC00\uC694?",
  q2: "\uB2E4\uC74C\uC5D0 \uC77C\uC5B4\uB0A0 \uC218 \uC788\uB294 \uC77C\uC744 \uC0DD\uAC01\uD574 \uBCFC \uC218 \uC788\uB098\uC694?",
  q3: "\uAE00\uC758 \uC2DC\uC791-\uC911\uAC04-\uB05D\uC744 \uC5B4\uB5BB\uAC8C \uC9DC\uBA74 \uC88B\uC744\uAE4C\uC694?",
  q4: "'very tired' \uB300\uC2E0 \uC4F8 \uC218 \uC788\uB294 \uB2E4\uB978 \uB2E8\uC5B4\uB294 \uBB34\uC5C7\uC778\uAC00\uC694?",
  r1: "\uB2E4\uC74C \uBB38\uB2E8\uC744 \uC368 \uC918.",
  r2: "\uB2F5\uC548\uC744 \uB2E4 \uC368 \uC918.",
  r3: "\uC774 \uAE00 \uC804\uCCB4\uB97C \uACE0\uCCD0 \uC918.",
  r4: "\uC774\uC57C\uAE30 \uC804\uCCB4\uB97C \uC694\uC57D\uD574 \uC918.",
  r5: "\uB354 \uD765\uBBF8\uB86D\uAC8C \uB298\uB824 \uC918.",
  lang: "\uC9C8\uBB38\uC740 \uD55C\uAD6D\uC5B4, \uC601\uC5B4, \uB610\uB294 \uB458 \uB2E4 \uC0AC\uC6A9\uD574\uB3C4 \uB429\uB2C8\uB2E4.",
  one: "\uD55C \uBC88\uC5D0 \uD55C \uAC00\uC9C0\uC529 \uBD84\uBA85\uD558\uAC8C \uC9C8\uBB38\uD558\uC138\uC694.",
  refuse:
    "\uCC57\uBD07\uC774 \uAC70\uC808\uD55C \uC694\uCCAD\uC740 \uD45C\uD604\uB9CC \uBC14\uAFD4\uC11C \uB2E4\uC2DC \uC2DC\uB3C4\uD558\uC9C0 \uB9C8\uC138\uC694.",
  shortReaction:
    "\uC9E7\uC740 \uBC18\uC751\uBCF4\uB2E4\uB294 '\uB2E4\uC2DC \uC124\uBA85\uD574\uC918', '\uC5B4\uB290 \uBD80\uBD84\uC774\uC57C?', '\uD55C \uBC88 \uB354 \uC27D\uAC8C \uB9D0\uD574\uC918'\uCC98\uB7FC \uC694\uCCAD\uC744 \uD568\uAED8 \uB9D0\uD574\uC8FC\uBA74 \uB354 \uC790\uC5F0\uC2A4\uB7FD\uAC8C \uB3C4\uC640\uB4DC\uB9B4 \uC218 \uC788\uC2B5\uB2C8\uB2E4.",
  read: "\uC548\uB0B4\uB97C \uC77D\uC5C8\uC2B5\uB2C8\uB2E4.",
  start: "\uC2DC\uC791\uD558\uAE30",
  participant: "\uCC38\uC5EC\uC790 ID",
  participantHint: "\uC608: P01, P02, P03",
  participantNeed:
    "\uC5F0\uAD6C\uC790\uC5D0\uAC8C \uBD80\uC5EC\uBC1B\uC740 \uCC38\uAC00\uC790 \uBC88\uD638\uB97C \uC785\uB825\uD55C \uB4A4 \uC548\uB0B4\uB97C \uD655\uC778\uD574 \uC8FC\uC138\uC694.",
  participantFormat:
    "\uCC38\uAC00\uC790 \uBC88\uD638\uB294 P01, P02 \uAC19\uC740 \uD615\uC2DD\uC73C\uB85C \uC785\uB825\uD574 \uC8FC\uC138\uC694.",
  changeParticipant: "\uCC38\uC5EC\uC790 \uBCC0\uACBD",
} as const;

function getStorageKey(participantId: string): string {
  return `${STORAGE_KEY_PREFIX}:${participantId}`;
}

function getGuideKey(participantId: string): string {
  return `${GUIDE_KEY_PREFIX}:${participantId}`;
}

function normalizeParticipantId(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

function isValidParticipantId(value: string): boolean {
  return /^P\d{2,}$/i.test(value);
}

function createTaskState(): TaskChatState {
  return {
    sessionId: crypto.randomUUID(),
    sessionStartedAt: Date.now(),
    interactionCount: 0,
    transcriptSaved: false,
    messages: [],
  };
}

function createInitialTaskStates(): Record<TaskId, TaskChatState> {
  return {
    task1: createTaskState(),
    task2: createTaskState(),
  };
}

function collectAssistantIds(states: Record<TaskId, TaskChatState>): Set<string> {
  const ids = new Set<string>();

  for (const taskId of TASK_IDS) {
    for (const message of states[taskId].messages) {
      if (message.role === "assistant") {
        ids.add(message.id);
      }
    }
  }

  return ids;
}

function isTaskId(value: string | null): value is TaskId {
  return value === "task1" || value === "task2";
}

function isTaskCondition(value: string | null): value is TaskCondition {
  return value === "static" || value === "dynamic";
}

function hydrateTaskStates(raw: string | null): Record<TaskId, TaskChatState> {
  if (!raw) {
    return createInitialTaskStates();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Record<TaskId, Partial<TaskChatState>>>;
    const next = createInitialTaskStates();

    for (const taskId of TASK_IDS) {
      const candidate = parsed[taskId];

      if (!candidate || !Array.isArray(candidate.messages)) {
        continue;
      }

      const hydratedMessages = candidate.messages
        .filter(
          (message): message is ChatMessage =>
            typeof message === "object" &&
            message !== null &&
            typeof message.id === "string" &&
            (message.role === "user" || message.role === "assistant") &&
            typeof message.text === "string"
        )
        .map((message) => ({
          id: message.id,
          role: message.role,
          text: message.text,
          quickReplies: Array.isArray(message.quickReplies)
            ? message.quickReplies.filter(isQuickReply)
            : undefined,
        }));

      const hasStaleAssistantText = hydratedMessages.some(
        (message) =>
          message.role === "assistant" &&
          (message.text.includes("[TODO]") || message.text.includes("Add the Task"))
      );

      if (hasStaleAssistantText) {
        next[taskId] = createTaskState();
        continue;
      }

      next[taskId] = {
        sessionId:
          typeof candidate.sessionId === "string" && candidate.sessionId
            ? candidate.sessionId
            : next[taskId].sessionId,
        sessionStartedAt:
          typeof candidate.sessionStartedAt === "number"
            ? candidate.sessionStartedAt
            : next[taskId].sessionStartedAt,
        interactionCount:
          typeof candidate.interactionCount === "number" ? candidate.interactionCount : 0,
        transcriptSaved: candidate.transcriptSaved === true,
        messages: hydratedMessages,
      };

      const firstMessage = next[taskId].messages[0];
      if (firstMessage?.id === "welcome" && firstMessage.role === "assistant") {
        next[taskId].messages = next[taskId].messages.slice(1);
      }
    }

    return next;
  } catch {
    return createInitialTaskStates();
  }
}

const GUIDE_COMPARE_ROWS = [
  {
    wrong: '"Write the ending."',
    better: '"What are 2 possible endings?"',
  },
  {
    wrong: '"Summarize the story."',
    better: '"What problem does the character face?"',
  },
  {
    wrong: '"Rewrite my paragraph."',
    better: '"Can you proofread my paragraph and explain the main fixes?"',
  },
  {
    wrong: '"??"',
    better: '"Explain the last point again more simply."',
  },
] as const;

const GUIDE_GATE_CARDS = [
  {
    eyebrow: "1",
    title: "Your Writing Task",
    titleKo: "여러분의 글쓰기 과제",
    items: [
      {
        text:
          "After the video or source story ends, continue the middle-to-later part of the story and complete the ending in your own English.",
        textKo:
          "영상이나 원래 이야기가 끝난 뒤부터, 이야기의 중간-후반부를 이어 쓰고 결말까지 여러분의 영어로 완성해야 합니다.",
      },
      {
        text:
          "The chatbot helps you think about events, logic, structure, and expressions; it does not write the continuation for you.",
        textKo:
          "챗봇은 사건, 논리, 구성, 표현을 생각하도록 도와주지만, 이어쓰기 답안을 대신 써주지는 않습니다.",
      },
      {
        text: "You may ask in Korean, English, or both.",
        textKo: "질문은 한국어, 영어, 또는 둘 다 사용해도 됩니다.",
      },
    ],
  },
  {
    eyebrow: "2",
    title: "✅ Ask Like This",
    titleKo: "이렇게 물어보세요",
    items: [
      {
        tone: "comprehension",
        label: "COMPREHENSION / 이야기 이해",
        text: '"What does this part mean?"',
        textKo: '"이 부분은 무슨 뜻인가요?"',
      },
      {
        tone: "ideation",
        label: "IDEATION / 아이디어 얻기",
        text: '"What are 2 next events that use the clue?"',
        textKo: '"그 단서를 사용한 다음 사건 2가지를 생각해 볼 수 있나요?"',
      },
      {
        tone: "organization",
        label: "ORGANIZATION / 구성 도움",
        text: '"How can I organize clue, thought, action, and result?"',
        textKo: '"단서, 생각, 행동, 결과를 어떤 순서로 정리하면 좋을까요?"',
      },
      {
        tone: "language",
        label: "LANGUAGE / 표현 도움",
        text: '"How can I say this idea in English?"',
        textKo: '"이 생각을 영어로 어떻게 말하면 좋을까요?"',
      },
      {
        tone: "feedback",
        label: "FEEDBACK / 확인과 피드백",
        text: '"Can you proofread my paragraph?"',
        textKo: '"내 문단을 피드백하고 고칠 부분을 알려줄래?"',
      },
      {
        tone: "procedural",
        label: "PROCEDURAL / 사용 방법과 절차",
        text: '"Can I ask in Korean?"',
        textKo: '"한국어로 질문해도 되나요?"',
      },
      {
        tone: "emphasis",
        text: "Try many other requests you want.",
        textKo: "그밖에 원하는 요청을 다양하게 넣어보세요.",
      },
    ],
  },
  {
    eyebrow: "3",
    title: "❌ Do Not Ask Like This",
    titleKo: "이렇게 묻지 마세요",
    items: [
      {
        text: '"Write the next paragraph."',
        textKo: '"다음 문단을 써줘."',
      },
      {
        text: '"Write the ending for me."',
        textKo: '"결말을 대신 써줘."',
      },
      {
        text: '"Rewrite my paragraph."',
        textKo: '"내 문단을 다시 써줘."',
      },
    ],
  },
  {
    eyebrow: "4",
    title: "Important Rules",
    titleKo: "중요한 규칙",
    items: [
      {
        text: "Ask one clear question at a time.",
        textKo: "한 번에 한 가지씩 분명하게 질문하세요.",
      },
      {
        text:
          "If the chatbot refuses a request, do not keep trying to get the same kind of answer in another way.",
        textKo: "챗봇이 거절한 요청은 표현만 바꿔서 다시 시도하지 마세요.",
      },
      {
        text:
          "If the reply feels unclear, ask it to explain one point again more simply.",
        textKo:
          "답변이 불분명하면 '다시 설명해줘', '어느 부분이야?', '한 번 더 쉽게 말해줘'처럼 구체적으로 물어보세요.",
      },
    ],
  },
] as const;

function GuideGateCards({
  activeIndex,
  onChange,
}: {
  activeIndex: number;
  onChange: (index: number) => void;
}) {
  const activeCard = GUIDE_GATE_CARDS[activeIndex];
  const lastIndex = GUIDE_GATE_CARDS.length - 1;
  const canGoPrevious = activeIndex > 0;
  const canGoNext = activeIndex < lastIndex;
  const previousIndex = Math.max(0, activeIndex - 1);
  const nextIndex = Math.min(lastIndex, activeIndex + 1);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);

  const goPrevious = useCallback(() => {
    if (canGoPrevious) {
      onChange(previousIndex);
    }
  }, [canGoPrevious, onChange, previousIndex]);

  const goNext = useCallback(() => {
    if (canGoNext) {
      onChange(nextIndex);
    }
  }, [canGoNext, nextIndex, onChange]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        goPrevious();
      }

      if (event.key === "ArrowRight") {
        goNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goNext, goPrevious]);

  const handleTouchStart = (event: TouchEvent<HTMLElement>) => {
    const touch = event.touches[0];
    swipeStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = (event: TouchEvent<HTMLElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;

    if (!start) {
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const swipeThreshold = 54;

    if (Math.abs(deltaX) < swipeThreshold || Math.abs(deltaX) <= Math.abs(deltaY)) {
      return;
    }

    if (deltaX < 0) {
      goNext();
      return;
    }

    goPrevious();
  };

  const renderDots = (position: "top" | "bottom") => (
    <div
      className={
        position === "top"
          ? "guide-card-dots guide-card-dots-top"
          : "guide-card-dots"
      }
      aria-label={`Manual card ${activeIndex + 1} of ${GUIDE_GATE_CARDS.length}`}
    >
      {GUIDE_GATE_CARDS.map((card, index) => (
        <button
          key={`${position}-${card.eyebrow}`}
          type="button"
          className={
            index === activeIndex ? "guide-card-dot guide-card-dot-active" : "guide-card-dot"
          }
          onClick={() => onChange(index)}
          aria-label={`Go to manual card ${index + 1}`}
          aria-current={index === activeIndex ? "true" : undefined}
        />
      ))}
    </div>
  );

  return (
    <section className="guide-card-news" aria-label="Manual">
      {renderDots("top")}
      <div className="guide-card-news-track">
        <button
          type="button"
          className="guide-card-arrow"
          onClick={goPrevious}
          disabled={!canGoPrevious}
          aria-label="Previous manual card"
          title="Previous"
        >
          &lt;
        </button>

        <article
          className="guide-card-slide"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <h2>
            <span>#{activeCard.eyebrow}.</span>
            {activeCard.title}
          </h2>
          <p className="guide-card-title-ko">{activeCard.titleKo}</p>
          <div className="guide-card-items">
            {activeCard.items.map((item) => (
              <div key={`${item.text}-${item.textKo}`} className="guide-card-item">
                {"label" in item ? (
                  <span
                    className={
                      "tone" in item
                        ? `guide-card-label guide-card-label-${item.tone}`
                        : "guide-card-label"
                    }
                  >
                    {item.label}
                  </span>
                ) : null}
                <p className={"tone" in item && item.tone === "emphasis" ? "guide-card-emphasis" : undefined}>
                  {item.text}
                  <br />
                  {item.textKo}
                </p>
              </div>
            ))}
          </div>
        </article>

        <button
          type="button"
          className="guide-card-arrow"
          onClick={goNext}
          disabled={!canGoNext}
          aria-label="Next manual card"
          title="Next"
        >
          &gt;
        </button>
      </div>
      <div className="guide-card-navigation" aria-label="Manual navigation">
        <button
          type="button"
          className="guide-card-nav-button"
          onClick={goPrevious}
          disabled={!canGoPrevious}
          aria-label="Previous manual card"
        >
          <span aria-hidden="true">←</span>
          Previous
        </button>
        {renderDots("bottom")}
        <button
          type="button"
          className="guide-card-nav-button"
          onClick={goNext}
          disabled={!canGoNext}
          aria-label="Next manual card"
        >
          Next
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function GuideContent() {
  return (
    <div className="guide-copy">
      <p>
        My Writing Assistant helps you develop, express, organize, and improve your
        continuation writing while keeping your work connected to the source.
        <br />
        {KO.intro}
      </p>
      <p>
        AI supports your thinking, but you must write the continuation yourself.
        <br />
        {KO.support}
      </p>

      <div className="guide-subsection">
        <p className="guide-subtitle">1. Languages / {KO.languageTitle}</p>
        <div className="guide-subsection">
          <p className="guide-subtitle">More Request Types / 더 물어볼 수 있는 요청</p>
          <ul className="guide-list guide-feature-list">
            <li>
              <span className="guide-feature-label guide-feature-label-feedback">
                FEEDBACK / 확인과 피드백
              </span>
              <br />
              <span className="guide-feature-example guide-feature-example-feedback">
                &quot;Is this idea connected to the story?&quot; / &quot;이 아이디어가 원래 이야기와 잘 연결되나요?&quot;
              </span>
            </li>
            <li>
              <span className="guide-feature-label guide-feature-label-procedural">
                PROCEDURAL / 사용 방법과 절차
              </span>
              <br />
              <span className="guide-feature-example guide-feature-example-procedural">
                &quot;Can I ask in Korean?&quot; / &quot;한국어로 질문해도 되나요?&quot;
              </span>
            </li>
            <li>그밖에 원하는 요청을 다양하게 넣어보세요.</li>
          </ul>
        </div>

        <ul className="guide-list">
          <li>
            You may ask in Korean, English, or both.
            <br />
            {KO.lang}
          </li>
          <li>
            <span className="guide-feature-label guide-feature-label-feedback">
              FEEDBACK / 확인과 피드백
            </span>
            <br />
            <span className="guide-feature-example guide-feature-example-feedback">
              &quot;Is this idea connected to the story?&quot; / &quot;이 아이디어가 원래 이야기와 잘 연결되나요?&quot;
            </span>
          </li>
          <li>
            <span className="guide-feature-label guide-feature-label-procedural">
              PROCEDURAL / 사용 방법과 절차
            </span>
            <br />
            <span className="guide-feature-example guide-feature-example-procedural">
              &quot;Can I ask in Korean?&quot; / &quot;한국어로 질문해도 되나요?&quot;
            </span>
          </li>
          <li>그밖에 원하는 요청을 다양하게 넣어보세요.</li>
        </ul>
      </div>

      <div className="guide-subsection">
        <p className="guide-subtitle">2. Allowed Use / {KO.allowedTitle}</p>
        <ul className="guide-list guide-list-numbered">
          <li>
            Understand the story
            <br />
            &quot;What does this part mean?&quot; / &quot;{KO.q1}&quot;
          </li>
          <li>
            Get ideas
            <br />
            &quot;Can you help me think of possible next events?&quot; / &quot;{KO.q2}&quot;
          </li>
          <li>
            Plan your story
            <br />
            &quot;How can I plan my story?&quot; / &quot;{KO.q3}&quot;
          </li>
          <li>
            Get word, expression, or language help
            <br />
            &quot;What word can I use instead of &apos;very tired&apos;?&quot; / &quot;{KO.q4}&quot;
          </li>
          <li>
            Get proofreading feedback on flow, logic, grammar, or awkward wording
            <br />
            &quot;Which part sounds awkward here?&quot; / &quot;어느 부분이 어색한지 하나만 짚어줄래?&quot;
          </li>
        </ul>
      </div>

      <div className="guide-subsection">
        <p className="guide-subtitle">3. Restricted Use / {KO.restrictedTitle}</p>
        <ul className="guide-list guide-list-numbered">
          <li>
            Do not ask the chatbot to write for you
            <br />
            &quot;Write the next paragraph.&quot; / &quot;{KO.r1}&quot;
          </li>
          <li>
            Do not ask for a full answer
            <br />
            &quot;Give me a full answer.&quot; / &quot;{KO.r2}&quot;
          </li>
          <li>
            Do not ask it to rewrite the whole draft as a new answer
            <br />
            &quot;Rewrite my paragraph.&quot; / &quot;{KO.r3}&quot;
          </li>
          <li>
            Do not ask it to add more content for you
            <br />
            &quot;Make it more interesting.&quot; / &quot;{KO.r5}&quot;
          </li>
        </ul>
      </div>

      <div className="guide-subsection">
        <p className="guide-subtitle">4. Good Use vs Wrong Use / {KO.goodTitle}</p>
        <div className="guide-compare">
          <div className="guide-compare-head guide-compare-wrong">Wrong / {KO.wrongUse}</div>
          <div className="guide-compare-head guide-compare-right">Better / {KO.betterUse}</div>
          {GUIDE_COMPARE_ROWS.map((row) => (
            <div key={row.wrong} className="guide-compare-row">
              <div
                className="guide-compare-cell"
                data-label={`Wrong / ${KO.wrongUse}`}
              >
                {row.wrong}
              </div>
              <div
                className="guide-compare-cell"
                data-label={`Better / ${KO.betterUse}`}
              >
                {row.better}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="guide-subsection">
        <p className="guide-subtitle">5. Important Rules / {KO.rulesTitle}</p>
        <ul className="guide-list">
          <li>
            Ask one clear question at a time.
            <br />
            {KO.one}
          </li>
          <li>
            If the chatbot refuses a request, do not keep trying to get the same kind of
            answer in another way.
            <br />
            {KO.refuse}
          </li>
          <li>
            If the reply feels unclear, ask it to explain one point again more simply.
            <br />
            {KO.shortReaction}
          </li>
        </ul>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function CompactGuideNotice({ onOpenGuide }: { onOpenGuide: () => void }) {
  return (
    <div className="guidance-box compact-guidance">
      <p>
        This chatbot can help with story understanding, next-event ideas, structure,
        expressions, and proofreading feedback.
        <br />
        이야기 이해, 다음 전개 아이디어, 구성 정리, 표현 찾기, 피드백과 교정에 사용할 수 있어요.
      </p>
      <p>
        It does not write the answer for you, rewrite the whole draft, or produce the
        full continuation.
        <br />
        전체 문단을 대신 쓰거나, 전체 글을 다시 쓰거나, 이어쓰기 답안을 완성해주지는 않아요.
      </p>
      <div className="compact-guidance-actions">
        <button type="button" className="secondary-button" onClick={onOpenGuide}>
          Open Full Guide
        </button>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function CompactGuideNoticeV2({ onOpenGuide }: { onOpenGuide: () => void }) {
  return (
    <div className="guidance-box compact-guidance">
      <p>이 챗봇으로 할 수 있는 도움:</p>
      <ul className="guide-list compact-guide-list">
        <li>이야기 이해</li>
        <li>다음 전개 아이디어</li>
        <li>구성 정리</li>
        <li>표현 찾기</li>
        <li>피드백과 교정</li>
      </ul>
      <p>이건 어려워요:</p>
      <ul className="guide-list compact-guide-list">
        <li>문단 대신 쓰기</li>
        <li>전체 글 다시 쓰기</li>
        <li>이어쓰기 답안 완성</li>
      </ul>
      <p>헷갈리면 이렇게 물어보세요.</p>
      <ul className="guide-list compact-guide-list">
        <li>&quot;방금 말 다시 쉽게 설명해줘&quot;</li>
        <li>&quot;이 부분만 다시 말해줘&quot;</li>
        <li>&quot;어색한 곳 하나만 짚어줘&quot;</li>
      </ul>
      <div className="compact-guidance-actions">
        <button type="button" className="secondary-button" onClick={onOpenGuide}>
          Open Full Guide
        </button>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function GuideContentV2() {
  return (
    <div className="guide-copy">
      <p>
        This chatbot is not a tool that writes for you. It helps you understand the
        story, think of ideas, plan your writing, and get language help.
        <br />
        {KO.intro}
      </p>
      <p>
        AI supports your thinking, but you must write the continuation yourself.
        <br />
        {KO.support}
      </p>

      <div className="guide-subsection">
        <p className="guide-subtitle">1. Languages / {KO.languageTitle}</p>
        <ul className="guide-list">
          <li>
            You may ask in Korean, English, or both.
            <br />
            {KO.lang}
          </li>
        </ul>
      </div>

      <div className="guide-subsection">
        <p className="guide-subtitle">2. Ask Like This / 이렇게 물어보세요</p>
        <ul className="guide-list guide-feature-list">
          <li>
            <span className="guide-feature-label guide-feature-label-comprehension">
              COMPREHENSION / 이야기 이해
            </span>
            <br />
            <span className="guide-feature-example guide-feature-example-comprehension">
              &quot;What does this part mean?&quot; / &quot;이 부분은 무슨 뜻인가요?&quot;
            </span>
          </li>
          <li>
            <span className="guide-feature-label guide-feature-label-ideation">
              IDEATION / 아이디어 얻기
            </span>
            <br />
            <span className="guide-feature-example guide-feature-example-ideation">
              &quot;What are 2 next events that use the clue?&quot; / &quot;그 단서를 사용한 다음 사건 2가지를 생각해 볼 수 있나요?&quot;
            </span>
          </li>
          <li>
            <span className="guide-feature-label guide-feature-label-organization">
              ORGANIZATION / 구성 도움
            </span>
            <br />
            <span className="guide-feature-example guide-feature-example-organization">
              &quot;How can I organize clue, thought, action, and result?&quot; / &quot;단서, 생각, 행동, 결과를 어떤 순서로 정리하면 좋을까요?&quot;
            </span>
          </li>
          <li>
            <span className="guide-feature-label guide-feature-label-language">
              LANGUAGE / 표현 도움
            </span>
            <br />
            <span className="guide-feature-example guide-feature-example-language">
              &quot;How can I say this idea in English?&quot; / &quot;이 생각을 영어로 어떻게 말하면 좋을까요?&quot;
            </span>
          </li>
        </ul>
      </div>

      <div className="guide-subsection">
        <p className="guide-subtitle">3. Do Not Ask Like This / 이렇게 묻지 마세요</p>
        <ul className="guide-list">
          <li>&quot;Write the next paragraph.&quot; / &quot;다음 문단을 써줘.&quot;</li>
          <li>&quot;Write the ending for me.&quot; / &quot;결말을 대신 써줘.&quot;</li>
          <li>&quot;Rewrite my paragraph.&quot; / &quot;내 문단을 다시 써줘.&quot;</li>
        </ul>
      </div>

      <div className="guide-subsection">
        <p className="guide-subtitle">4. Important Rules / {KO.rulesTitle}</p>
        <ul className="guide-list">
          <li>
            Ask one clear question at a time.
            <br />
            {KO.one}
          </li>
          <li>
            If the chatbot refuses a request, do not keep trying to get the same kind of
            answer in another way.
            <br />
            {KO.refuse}
          </li>
          <li>
            If the reply feels unclear, ask it to explain one point again more simply.
            <br />
            {KO.shortReaction}
          </li>
        </ul>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function GuideContentV3() {
  return (
    <div className="guide-copy">
      <p>
        My Writing Assistant helps you develop, express, organize, and improve your
        continuation writing while keeping your work connected to the source.
        <br />
        {KO.intro}
      </p>
      <p>
        AI supports your thinking, but you must write the continuation yourself.
        <br />
        {KO.support}
      </p>

      <div className="guide-subsection">
        <p className="guide-subtitle">1. Languages / {KO.languageTitle}</p>
        <ul className="guide-list">
          <li>
            You may ask in Korean, English, or both.
            <br />
            {KO.lang}
          </li>
        </ul>
      </div>

      <div className="guide-subsection">
        <p className="guide-subtitle">2. Ask Like This / 이렇게 물어보세요</p>
        <ul className="guide-list guide-feature-list">
          <li>
            <span className="guide-feature-label guide-feature-label-comprehension">
              COMPREHENSION / 이야기 이해
            </span>
            <br />
            <span className="guide-feature-example guide-feature-example-comprehension">
              &quot;What does this part mean?&quot; / &quot;이 부분은 무슨 뜻인가요?&quot;
            </span>
          </li>
          <li>
            <span className="guide-feature-label guide-feature-label-ideation">
              IDEA GENERATION / 아이디어 얻기
            </span>
            <br />
            <span className="guide-feature-example guide-feature-example-ideation">
              &quot;What are 2 next events that use the clue?&quot; / &quot;그 단서를 사용한 다음 사건 2가지를 생각해 볼 수 있나요?&quot;
            </span>
          </li>
          <li>
            <span className="guide-feature-label guide-feature-label-organization">
              ORGANIZATION / 구성 도움
            </span>
            <br />
            <span className="guide-feature-example guide-feature-example-organization">
              &quot;How can I organize clue, thought, action, and result?&quot; / &quot;단서, 생각, 행동, 결과를 어떤 순서로 정리하면 좋을까요?&quot;
            </span>
          </li>
          <li>
            <span className="guide-feature-label guide-feature-label-language">
              VOCABULARY &amp; EXPRESSION / 단어와 표현 도움
            </span>
            <br />
            <span className="guide-feature-example guide-feature-example-language">
              &quot;How can I say this idea in English?&quot; / &quot;이 생각을 영어로 어떻게 말하면 좋을까요?&quot;
            </span>
          </li>
          <li>
            <span className="guide-feature-label guide-feature-label-feedback">
              FEEDBACK / 확인과 피드백
            </span>
            <br />
            <span className="guide-feature-example guide-feature-example-feedback">
              &quot;Is this idea connected to the story?&quot; / &quot;이 아이디어가 원래 이야기와 잘 연결되나요?&quot;
            </span>
          </li>
          <li>
            <span className="guide-feature-label guide-feature-label-procedural">
              PROCEDURAL / 사용 방법과 절차
            </span>
            <br />
            <span className="guide-feature-example guide-feature-example-procedural">
              &quot;Can I ask in Korean?&quot; / &quot;한국어로 질문해도 되나요?&quot;
            </span>
          </li>
          <li><strong>그밖에 원하는 요청을 다양하게 넣어보세요.</strong></li>
        </ul>
      </div>

      <div className="guide-subsection">
        <p className="guide-subtitle">3. ❌ Do Not Ask Like This / 이렇게 묻지 마세요</p>
        <ul className="guide-list">
          <li>&quot;Write the next paragraph.&quot; / &quot;다음 문단을 써줘.&quot;</li>
          <li>&quot;Write the ending for me.&quot; / &quot;결말을 대신 써줘.&quot;</li>
          <li>&quot;Rewrite my paragraph.&quot; / &quot;내 문단을 다시 써줘.&quot;</li>
          <li>&quot;Give me a score.&quot; / &quot;이 글은 몇 점이야?&quot;</li>
        </ul>
      </div>

      <div className="guide-subsection">
        <p className="guide-subtitle">4. Important Rules / {KO.rulesTitle}</p>
        <ul className="guide-list">
          <li>
            Ask one clear question at a time.
            <br />
            {KO.one}
          </li>
          <li>
            If the chatbot refuses a request, do not keep trying to get the same kind of
            answer in another way.
            <br />
            {KO.refuse}
          </li>
          <li>
            If the reply feels unclear, ask it to explain one point again more simply.
            <br />
            {KO.shortReaction}
          </li>
        </ul>
      </div>
    </div>
  );
}

export default function Home() {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isComposerMultiline, setIsComposerMultiline] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskId>("task1");
  const [selectedCondition, setSelectedCondition] = useState<TaskCondition>("static");
  const [taskStates, setTaskStates] = useState<Record<TaskId, TaskChatState>>(
    createInitialTaskStates
  );
  const [participantId, setParticipantId] = useState("");
  const [participantInput, setParticipantInput] = useState("");
  const [guideAccepted, setGuideAccepted] = useState(false);
  const [guideChecked, setGuideChecked] = useState(false);
  const [guideGateCardIndex, setGuideGateCardIndex] = useState(0);
  const [showGuide, setShowGuide] = useState(true);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminResetCode, setAdminResetCode] = useState("");
  const [adminResetMessage, setAdminResetMessage] = useState("");
  const messageThreadRef = useRef<HTMLDivElement | null>(null);
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const taskStatesRef = useRef(taskStates);
  const revealedAssistantIdsRef = useRef<Set<string>>(collectAssistantIds(taskStates));
  const inFlightRequestRef = useRef<AbortController | null>(null);
  const loadingTimeoutRef = useRef<number | null>(null);
  const inputUndoStackRef = useRef<string[]>([]);
  const shouldAutoScrollRef = useRef(true);

  const resizeChatInput = useCallback((element: HTMLTextAreaElement) => {
    element.style.height = `${CHAT_INPUT_BASE_HEIGHT}px`;
    const nextHeight = Math.min(element.scrollHeight, CHAT_INPUT_MAX_HEIGHT);
    element.style.height = `${Math.max(CHAT_INPUT_BASE_HEIGHT, nextHeight)}px`;
    element.style.overflowY = element.scrollHeight > CHAT_INPUT_MAX_HEIGHT ? "auto" : "hidden";
    setIsComposerMultiline(element.scrollHeight > CHAT_INPUT_BASE_HEIGHT + 8);
  }, []);

  const resetChatInputHeight = useCallback(() => {
    const element = inputRef.current;

    if (!element) {
      return;
    }

    element.style.height = `${CHAT_INPUT_BASE_HEIGHT}px`;
    element.style.overflowY = "hidden";
    setIsComposerMultiline(false);
  }, []);

  const activeTaskState = useMemo(() => taskStates[selectedTask], [selectedTask, taskStates]);
  const normalizedParticipantInput = useMemo(
    () => normalizeParticipantId(participantInput),
    [participantInput]
  );
  const isParticipantReady = isValidParticipantId(normalizedParticipantInput);

  useEffect(() => {
    taskStatesRef.current = taskStates;
  }, [taskStates]);

  useEffect(() => {
    if (!input) {
      resetChatInputHeight();
    }
  }, [input, resetChatInputHeight]);

  useEffect(() => {
    return () => {
      inFlightRequestRef.current?.abort();
      if (loadingTimeoutRef.current !== null) {
        window.clearTimeout(loadingTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!guideAccepted) {
      return;
    }

    const lastMessage = activeTaskState.messages[activeTaskState.messages.length - 1];
    if (lastMessage?.role === "assistant") {
      revealedAssistantIdsRef.current.add(lastMessage.id);
    }
  }, [activeTaskState.messages, guideAccepted]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const taskParam = params.get("task");
    const conditionParam = params.get("condition");

    const initialStates = createInitialTaskStates();

    setParticipantId("");
    setParticipantInput("");
    setTaskStates(initialStates);
    revealedAssistantIdsRef.current = collectAssistantIds(initialStates);
    setGuideAccepted(false);
    setGuideChecked(false);
    setShowGuide(true);

    if (isTaskId(taskParam)) {
      setSelectedTask(taskParam);
    }

    if (isTaskCondition(conditionParam)) {
      setSelectedCondition(conditionParam);
    }
  }, []);

  useEffect(() => {
    if (!participantId) {
      return;
    }

    window.localStorage.setItem(getStorageKey(participantId), JSON.stringify(taskStates));
    window.localStorage.setItem(CURRENT_PARTICIPANT_KEY, participantId);
  }, [participantId, taskStates]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("task", selectedTask);
    params.set("condition", selectedCondition);
    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
  }, [selectedTask, selectedCondition]);

  const updateAutoScrollPreference = useCallback(() => {
    const element = messageThreadRef.current;

    if (!element) {
      shouldAutoScrollRef.current = true;
      return;
    }

    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 120;
  }, []);

  useEffect(() => {
    if (!shouldAutoScrollRef.current) {
      return;
    }

    threadEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [activeTaskState.messages, isLoading, selectedTask]);

  const persistTranscript = useCallback(
    async (taskId: TaskId, state: TaskChatState, isFinal = false) => {
      if (!state.sessionId || state.interactionCount <= 0 || state.transcriptSaved) {
        return;
      }

      const payload = {
        taskId,
        participantId,
        sessionId: state.sessionId,
        condition: selectedCondition,
        interactionCount: state.interactionCount,
        sessionStartedAt: state.sessionStartedAt,
        isFinal,
        messages: state.messages.map<StoredTranscriptMessage>(({ role, text }) => ({
          role,
          text,
        })),
      };

      try {
        if (isFinal && typeof navigator.sendBeacon === "function") {
          const blob = new Blob([JSON.stringify(payload)], {
            type: "application/json",
          });
          const accepted = navigator.sendBeacon("/api/session", blob);

          if (accepted) {
            setTaskStates((current) => ({
              ...current,
              [taskId]: {
                ...current[taskId],
                transcriptSaved: true,
              },
            }));
            return;
          }
        }

        await fetch("/api/session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          keepalive: isFinal,
        });

        setTaskStates((current) => ({
          ...current,
          [taskId]: {
            ...current[taskId],
            transcriptSaved: true,
          },
        }));
      } catch (error) {
        console.error("Failed to persist session transcript", error);
      }
    },
    [participantId, selectedCondition]
  );

  useEffect(() => {
    const flushAllTranscripts = () => {
      const entries = Object.entries(taskStatesRef.current) as Array<[TaskId, TaskChatState]>;

      for (const [taskId, state] of entries) {
        if (!state.transcriptSaved && state.interactionCount > 0) {
          void persistTranscript(taskId, state, true);
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushAllTranscripts();
      }
    };

    window.addEventListener("pagehide", flushAllTranscripts);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      flushAllTranscripts();
      window.removeEventListener("pagehide", flushAllTranscripts);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [persistTranscript]);

  const send = async (
    overrideText?: string,
    inputOrigin: "typed" | "quick_reply" | "prefill_edited" = "typed"
  ) => {
    const outgoingText = overrideText ?? input;

    if (!outgoingText.trim() || isLoading) {
      return;
    }

    const userText = outgoingText.trim();
    inputUndoStackRef.current.push(userText);
    const requestTask = selectedTask;
    const currentState = taskStatesRef.current[requestTask];
    const requestSessionId = currentState.sessionId;
    const nextInteractionCount = currentState.interactionCount + 1;
    const userMessage: ChatMessage = {
      id: `${Date.now()}-user`,
      role: "user",
      text: userText,
    };
    const assistantMessageId = `${Date.now()}-assistant`;
    const pendingAssistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      text: "",
      isStreaming: true,
    };

    shouldAutoScrollRef.current = true;

    setTaskStates((current) => ({
      ...current,
      [requestTask]: {
        ...current[requestTask],
        interactionCount: nextInteractionCount,
        transcriptSaved: false,
        messages: [...current[requestTask].messages, userMessage, pendingAssistantMessage],
      },
    }));

    setInput("");
    resetChatInputHeight();
    setIsLoading(true);

    const controller = new AbortController();
    inFlightRequestRef.current = controller;
    loadingTimeoutRef.current = window.setTimeout(() => {
      controller.abort();
    }, 60000);

    let streamedAssistantText = "";

    const updateAssistantMessage = (partial: Partial<ChatMessage>) => {
      setTaskStates((current) => ({
        ...current,
        [requestTask]: {
          ...current[requestTask],
          transcriptSaved: false,
          messages: current[requestTask].messages.map((message) =>
            message.id === assistantMessageId ? { ...message, ...partial } : message
          ),
        },
      }));
    };

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          taskId: requestTask,
          participantId,
          query: userText,
          recentMessages: currentState.messages
            .filter((message) => message.id !== "welcome")
            .map(({ role, text }) => ({ role, text })),
          category: "Others",
          condition: selectedCondition,
          sessionId: requestSessionId,
          interactionCount: nextInteractionCount,
          sessionStartedAt: currentState.sessionStartedAt,
          input_origin: inputOrigin,
          stream: true,
        }),
        signal: controller.signal,
      });

      const contentType = res.headers.get("content-type") || "";
      let assistantPayload: ChatApiResponse = {
        text: "I could not make a reply just now. Please try once more.",
        status: "error",
      };

      if (contentType.includes("application/x-ndjson") && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let finalPayload: ChatApiResponse | null = null;
        let clientReceivedEventCount = 0;
        let uiUpdateCount = 0;

        while (true) {
          const { value, done } = await reader.read();

          if (done) {
            break;
          }

          const parsedChunk = parseChatStreamChunk(buffer, decoder.decode(value, { stream: true }));
          buffer = parsedChunk.buffer;

          if (parsedChunk.malformedLines.length > 0) {
            console.warn("Malformed chat stream event ignored", parsedChunk.malformedLines.length);
          }

          for (const parsed of parsedChunk.events) {
            clientReceivedEventCount += 1;

            if (parsed.type === "delta") {
              streamedAssistantText += parsed.delta;
              uiUpdateCount += 1;
              updateAssistantMessage({
                text: streamedAssistantText,
                isStreaming: true,
              });
            } else if (parsed.type === "done") {
              finalPayload = parsed.payload;
            } else if (parsed.type === "error") {
              finalPayload = parsed.payload;
              throw new Error(parsed.payload.reason || "stream_error");
            }
          }
        }

        const remainingText = decoder.decode();
        const flushed = flushChatStreamBuffer(buffer + remainingText);

        if (flushed.malformedLines.length > 0) {
          console.warn("Malformed chat stream tail ignored", flushed.malformedLines.length);
        }

        for (const parsed of flushed.events) {
          clientReceivedEventCount += 1;

          if (parsed.type === "delta") {
            streamedAssistantText += parsed.delta;
            uiUpdateCount += 1;
            updateAssistantMessage({
              text: streamedAssistantText,
              isStreaming: true,
            });
          } else if (parsed.type === "done" || parsed.type === "error") {
            finalPayload = parsed.payload;
          }
        }

        if (process.env.NODE_ENV !== "production") {
          console.debug("chat_stream_client_debug", {
            clientReceivedEventCount,
            uiUpdateCount,
            finalCharacterCount: streamedAssistantText.length,
            renderMode: streamedAssistantText ? "progressive" : "buffered",
          });
        }

        if (!finalPayload) {
          throw new Error("stream_incomplete");
        }

        assistantPayload = finalPayload;
      } else {
        const rawResponse = await res.text();

        if (contentType.includes("application/json")) {
        try {
          const parsed = JSON.parse(rawResponse);

          if (isChatApiResponse(parsed)) {
            assistantPayload = parsed;
          }
        } catch {
          assistantPayload = {
            text: "I could not make a reply just now. Please try once more.",
            status: "error",
          };
        }
        } else if (rawResponse.trim()) {
          assistantPayload = { text: rawResponse };
        }
      }

      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: "assistant",
        text: assistantPayload.text || streamedAssistantText,
        quickReplies: assistantPayload.quickReplies,
      };
      const messagesWithResponse = [...currentState.messages, userMessage, assistantMessage];
      const nextState: TaskChatState = {
        ...currentState,
        interactionCount: nextInteractionCount,
        transcriptSaved: false,
        messages: messagesWithResponse,
      };

      updateAssistantMessage({
        text: assistantMessage.text,
        quickReplies: assistantMessage.quickReplies,
        isStreaming: false,
        isError: assistantPayload.status === "error" || assistantPayload.status === "timeout",
      });

      void persistTranscript(requestTask, nextState, false);
    } catch (error) {
      console.error(error);
      const message =
        error instanceof Error && error.name === "AbortError"
          ? "응답이 중단되었습니다. 다시 시도해 주세요."
          : "응답이 중단되었습니다. 다시 시도해 주세요.";

      updateAssistantMessage({
        text: streamedAssistantText ? `${streamedAssistantText}\n\n${message}` : message,
        isStreaming: false,
        isError: true,
      });
    } finally {
      if (loadingTimeoutRef.current !== null) {
        window.clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
      inFlightRequestRef.current = null;
      setIsLoading(false);
    }
  };

  const handleGuideConfirm = () => {
    const trimmedParticipantId = normalizedParticipantInput;

    if (!guideChecked || !isParticipantReady) {
      return;
    }

    const nextTaskStates = hydrateTaskStates(
      window.localStorage.getItem(getStorageKey(trimmedParticipantId))
    );

    window.localStorage.setItem(CURRENT_PARTICIPANT_KEY, trimmedParticipantId);
    window.localStorage.setItem(getGuideKey(trimmedParticipantId), "true");
    setParticipantId(trimmedParticipantId);
    setParticipantInput(trimmedParticipantId);
    setTaskStates(nextTaskStates);
    revealedAssistantIdsRef.current = collectAssistantIds(nextTaskStates);
    setGuideAccepted(true);
    setShowGuide(false);
    setGuideChecked(false);
  };

  const returnToHomeScreen = () => {
    setGuideAccepted(false);
    setGuideChecked(false);
    setShowGuide(true);
    setInput("");
  };

  const stopGenerating = () => {
    inFlightRequestRef.current?.abort();
  };

  const displayTaskLabel = selectedTask === "task2" ? "EP2" : "EP1";
  const hasStartedChat = activeTaskState.messages.some((message) => message.role === "user");

  const clearSavedLocalLogs = () => {
    if (adminResetCode !== "0784") {
      setAdminResetMessage("Password does not match.");
      return;
    }

    const keysToRemove: string[] = [];
    const statePrefixes = [
      "writing-assistant-task-state-v1:",
      "writing-assistant-task-state-v2:",
      "writing-assistant-task-state-v3:",
      "writing-assistant-task-state-v4:",
      "writing-assistant-task-state-v5:",
      "writing-assistant-task-state-v6:",
    ];
    const guidePrefixes = [
      "writing-assistant-guide-accepted-v1:",
      "writing-assistant-guide-accepted-v2:",
      "writing-assistant-guide-accepted-v3:",
      "writing-assistant-guide-accepted-v4:",
      "writing-assistant-guide-accepted-v5:",
      "writing-assistant-guide-accepted-v6:",
    ];
    const participantKeys = [
      "writing-assistant-current-participant-v1",
      "writing-assistant-current-participant-v2",
      "writing-assistant-current-participant-v3",
      "writing-assistant-current-participant-v4",
    ];

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);

      if (
        key &&
        (statePrefixes.some((prefix) => key.startsWith(prefix)) ||
          guidePrefixes.some((prefix) => key.startsWith(prefix)) ||
          participantKeys.includes(key))
      ) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      window.localStorage.removeItem(key);
    }
    const initialStates = createInitialTaskStates();
    setTaskStates(initialStates);
    taskStatesRef.current = initialStates;
    revealedAssistantIdsRef.current = collectAssistantIds(initialStates);
    setParticipantId("");
    setParticipantInput("");
    setGuideAccepted(false);
    setGuideChecked(false);
    setGuideGateCardIndex(0);
    setShowGuide(true);
    setInput("");
    setSelectedTask("task1");
    setAdminResetCode("");
    setAdminResetMessage("Saved local conversation history has been cleared.");
    setShowAdminPanel(false);
  };

  return (
    <main className="chat-shell">
      {!guideAccepted ? (
        <section className="guide-gate-card">
          <div className="guide-gate-header">
            <h1>My Writing Assistant</h1>
          </div>

          <div className="guide-task-panel">
            <p className="section-label">Choose your task</p>
            <div className="guide-task-switcher" role="tablist" aria-label="Task selection">
              {TASK_IDS.map((taskId) => (
                <button
                  key={taskId}
                  type="button"
                  className={
                    taskId === selectedTask ? "guide-task-tab guide-task-tab-active" : "guide-task-tab"
                  }
                  onClick={() => setSelectedTask(taskId)}
                >
                  {taskId === "task2" ? "EP2" : "EP1"}
                </button>
              ))}
            </div>
          </div>

          <div className="participant-panel">
            <label className="section-label" htmlFor="participant-id">
              Participant ID / {KO.participant}
            </label>
            <input
              id="participant-id"
              type="text"
              value={participantInput}
              onChange={(event) => setParticipantInput(normalizeParticipantId(event.target.value))}
              className="participant-input"
              placeholder={`e.g., P01, P02, P03 / ${KO.participantHint}`}
            />
            <p className="participant-help">
              Please enter the participant ID given by the researcher.
              <br />
              {KO.participantNeed}
            </p>
          </div>

          <GuideGateCards
            activeIndex={guideGateCardIndex}
            onChange={setGuideGateCardIndex}
          />

          <label className="guide-check">
            <input
              type="checkbox"
              checked={guideChecked}
              onChange={(event) => setGuideChecked(event.target.checked)}
            />
            <span>I have read this guide. / {KO.read}</span>
          </label>

          <div className="guide-actions">
            <button
              type="button"
              className="start-button"
              disabled={!guideChecked || !isParticipantReady}
              onClick={handleGuideConfirm}
            >
              Start / {KO.start}
            </button>
          </div>

          {participantInput.trim() && !isParticipantReady ? (
            <p className="guide-warning">{KO.participantFormat}</p>
          ) : null}
        </section>
      ) : (
        <section className={hasStartedChat ? "chat-card chat-card-active" : "chat-card"}>
          <div className="chat-header">
            <div className="chat-title-group">
              <h1>My Writing Assistant</h1>
              <p className="chat-session-caption">
                {displayTaskLabel} / Participant no.: {participantId}
              </p>
            </div>

            <div className="chat-header-actions">
              <button
                type="button"
                className="icon-button"
                onClick={returnToHomeScreen}
                aria-label="Go to Home"
                title="Go to Home"
              >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                      <polyline points="9 22 9 12 15 12 15 22"/>
                  </svg>
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowGuide(true)}
                aria-label="Read Guide Again"
                title="Read Guide Again"
              >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                  </svg>
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => {
                  setShowAdminPanel((current) => !current);
                  setAdminResetMessage("");
                }}
                aria-label="Administrator"
                title="Administrator"
              >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3"/>
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                  </svg>
              </button>
            </div>
          </div>

          {!hasStartedChat ? (
          <section className="chat-hero" aria-label="Chat introduction">
            <p className="participant-caption">{displayTaskLabel} 쨌 Participant ID: {participantId}</p>
            <h2>How can I help with your writing?</h2>
          </section>
          ) : null}

          {showAdminPanel ? (
            <section className="admin-reset-panel admin-reset-panel-inline">
              <p className="section-label">Administrator</p>
              <p className="admin-reset-copy">
                Enter the admin password to clear saved local conversation history on this
                browser.
              </p>
              <div className="admin-reset-controls">
                <input
                  type="password"
                  value={adminResetCode}
                  onChange={(event) => setAdminResetCode(event.target.value)}
                  className="participant-input admin-reset-input"
                  placeholder="Enter admin password"
                />
                <button
                  type="button"
                  className="secondary-button admin-reset-button"
                  onClick={clearSavedLocalLogs}
                >
                  Clear Saved Chats
                </button>
              </div>
              {adminResetMessage ? (
                <p className="admin-reset-message">{adminResetMessage}</p>
              ) : null}
            </section>
          ) : null}

          <section className="thread-section">
            <div
              ref={messageThreadRef}
              className="message-thread"
              onScroll={updateAutoScrollPreference}
            >
              {activeTaskState.messages.map((message) => (
                <div
                  key={message.id}
                  className={
                    message.role === "user"
                      ? "message-row message-row-user message-row-enter"
                      : "message-row message-row-assistant message-row-enter"
                  }
                >
                  <div
                    className={
                      message.role === "user"
                        ? "message-bubble message-bubble-user"
                        : "message-bubble message-bubble-assistant"
                    }
                  >
                    <div className="message-role">
                      {message.role === "user" ? "You" : "Assistant"}
                    </div>
                    <div className="message-text">
                      {message.role === "assistant"
                        ? renderAssistantText(message.text, message.isStreaming, message.isError)
                        : message.text}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={threadEndRef} />
            </div>
            <div
              className={
                isComposerMultiline
                  ? "composer-inline composer-inline-multiline"
                  : "composer-inline"
              }
            >
              <textarea
                id="chat-input"
                ref={inputRef}
                value={input}
                onChange={(event) => {
                    setInput(event.target.value);
                    resizeChatInput(event.target);
                }}
                onKeyDown={(event) => {
                  if (
                    (event.ctrlKey || event.metaKey) &&
                    event.key.toLowerCase() === "z" &&
                    (!input || isExamplePromptText(input))
                  ) {
                    const previousInput = inputUndoStackRef.current.pop();
                    if (previousInput) {
                      event.preventDefault();
                      setInput(previousInput);
                    }
                    return;
                  }

                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                rows={4}
                className="chat-input"
                style={{ height: CHAT_INPUT_BASE_HEIGHT }}
                placeholder={CHAT_INPUT_PLACEHOLDER}
              />

              <div className="composer-footer">
                <button
                  onClick={isLoading ? stopGenerating : () => void send()}
                  className={isLoading ? "send-button stop-button" : "send-button"}
                  type="button"
                >
                  {isLoading ? "Stop" : "Send"}
                </button>
              </div>
            </div>
          </section>
        </section>
      )}

      {guideAccepted && showGuide ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-card" role="dialog" aria-modal="true" aria-label="Guide">
            <div className="modal-header">
              <div>
                <h2>Quick Guide / 빠른 안내</h2>
              </div>
            </div>

            <div className="modal-guide-panel">
              <GuideGateCards
                activeIndex={guideGateCardIndex}
                onChange={setGuideGateCardIndex}
              />
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowGuide(false)}
              >
                Close / 닫기
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
