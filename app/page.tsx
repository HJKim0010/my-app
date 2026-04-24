"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type TaskId = "task1" | "task2";
type TaskCondition = "static" | "dynamic";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
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
const EXAMPLE_PROMPTS = [
  "이 이야기 다음에 가능한 전개 2개 알려줘",
  "이 장면의 감정을 영어로 표현하면?",
  "내 글 구조를 간단히 정리해줘",
  "이 단어 대신 쓸 수 있는 표현 3개만",
] as const;

const CHAT_EXAMPLE_PROMPTS = [
  {
    category: "Comprehension",
    en: "Help me understand this scene",
    ko: "\uC774 \uC7A5\uBA74\uC5D0\uC11C \uBB34\uC2A8 \uC77C\uC774 \uC77C\uC5B4\uB098\uB294\uC9C0 \uC124\uBA85\uD574\uC918",
  },
  {
    category: "Ideation",
    en: "Suggest 2 possible next events",
    ko: "\uC774 \uC774\uC57C\uAE30 \uB2E4\uC74C\uC5D0 \uAC00\uB2A5\uD55C \uC804\uAC1C 2\uAC1C \uC54C\uB824\uC918",
  },
  {
    category: "Organization",
    en: "Help me organize my continuation",
    ko: "\uB0B4 \uB4B7\uC774\uC57C\uAE30 \uAD6C\uC131\uC744 \uAC04\uB2E8\uD558\uAC8C \uC815\uB9AC\uD574\uC918",
  },
  {
    category: "Language",
    en: "Give me 3 similar words",
    ko: "\uC774 \uB2E8\uC5B4 \uB300\uC2E0 \uC4F8 \uC218 \uC788\uB294 \uB2E4\uB978 \uB2E8\uC5B4 3\uAC1C\uB9CC",
  },
  {
    category: "Language",
    en: "Help me say this more naturally",
    ko: "\uC774 \uB9D0\uC744 \uB354 \uC790\uC5F0\uC2A4\uB7FD\uAC8C \uD45C\uD604\uD558\uB824\uBA74?",
  },
] as const;

const COMPOSER_HELP_TITLE =
  "Example Questions";

const COMPOSER_HELP_TITLE_KO = "\uC9C8\uBB38 \uC608\uC2DC";

const COMPOSER_HELP_TEXT =
  "Pick one question by category: comprehension, ideation, organization, or language help.";

const COMPOSER_HELP_TEXT_KO =
  "\uC774\uD574, \uC544\uC774\uB514\uC5B4, \uAD6C\uC131, \uC5B8\uC5B4 \uBC94\uC8FC\uC5D0\uC11C \uD558\uB098\uC529 \uACE8\uB77C \uC9C8\uBB38\uD558\uBA74 \uAC00\uB3C5\uC131 \uC88B\uAC8C \uB3C4\uC640\uB4DC\uB9B4\uAC8C\uC694.";

const CHAT_INPUT_PLACEHOLDER =
  "Example: What clue or hint would help me continue this story logically? / \uC608: \uB2E4\uC74C \uC774\uC57C\uAE30 \uC804\uAC1C\uB97C \uB17C\uB9AC\uC801\uC73C\uB85C \uC774\uC5B4\uAC00\uB824\uBA74 \uBB34\uC2A8 \uD78C\uD2B8\uAC00 \uD544\uC694\uD574?";

const KO = {
  intro:
    "\uC774 \uCC57\uBD07\uC740 \uAE00\uC744 \uB300\uC2E0 \uC368\uC8FC\uB294 \uB3C4\uAD6C\uAC00 \uC544\uB2D9\uB2C8\uB2E4. \uC774\uC57C\uAE30\uB97C \uC774\uD574\uD558\uACE0, \uC544\uC774\uB514\uC5B4\uB97C \uC0DD\uAC01\uD558\uACE0, \uAE00\uC744 \uACC4\uD68D\uD558\uACE0, \uC5B8\uC5B4 \uD45C\uD604\uC744 \uB3D5\uB294 \uB3C4\uAD6C\uC785\uB2C8\uB2E4.",
  support:
    "AI\uB294 \uC0DD\uAC01\uC744 \uB3D5\uACE0, \uAE00\uC740 \uC5EC\uB7EC\uBD84\uC774 \uC9C1\uC811 \uC791\uC131\uD574\uC57C \uD569\uB2C8\uB2E4.",
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

function buildWelcomeMessage(): ChatMessage {
  return {
    id: "welcome",
    role: "assistant",
    text:
      "이 챗봇은 다음을 도와줄 수 있습니다:\n\n* 이야기 이해하기\n* 다음 전개 아이디어 찾기\n* 글 구조 정리하기\n* 영어 표현/단어 찾기\n\n하지만 다음은 해주지 않습니다:\n\n* 문장이나 문단을 대신 작성\n* 전체 글 수정 또는 첨삭\n* 전체 내용 요약",
  };
}

function buildCurrentWelcomeMessage(): ChatMessage {
  return {
    id: "welcome",
    role: "assistant",
    text:
      "이 챗봇은 이야기 이해, 다음 전개 아이디어, 글 구조 정리, 영어 표현 찾기, 그리고 짧은 흐름/표현 피드백을 도와줄 수 있어요.\n\n대신 문장이나 문단을 대신 써주거나, 전체 글을 고쳐주거나, 전체 내용을 요약해주지는 않아요.\n\n막히면 한 번에 한 가지씩 물어보세요. 예: \"이 부분이 왜 중요한지 설명해줘\" / \"다음 전개 2가지만 알려줘\" / \"어색한 부분 하나만 짚어줘\"",
  };
}

function createTaskState(): TaskChatState {
  return {
    sessionId: crypto.randomUUID(),
    sessionStartedAt: Date.now(),
    interactionCount: 0,
    transcriptSaved: false,
    messages: [buildCurrentWelcomeMessage()],
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

      if (next[taskId].messages.length === 0) {
        next[taskId].messages = [buildCurrentWelcomeMessage()];
        continue;
      }

      const firstMessage = next[taskId].messages[0];
      if (firstMessage?.id === "welcome" && firstMessage.role === "assistant") {
        next[taskId].messages[0] = buildCurrentWelcomeMessage();
      } else {
        next[taskId].messages = [buildCurrentWelcomeMessage(), ...next[taskId].messages];
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
    wrong: '"Fix my paragraph."',
    better: '"Can you point out one awkward part in this paragraph?"',
  },
  {
    wrong: '"응?"',
    better: '"Explain the last point again more simply."',
  },
] as const;

const GUIDE_REQUEST_ROWS = [
  {
    category: "comprehension",
    allowed: "Understand the story",
    avoid: '"Summarize the whole story."',
    better: '"What problem does the character face here?"',
  },
  {
    category: "ideation",
    allowed: "Get ideas",
    avoid: '"Write the next paragraph."',
    better: '"What are 2 possible next events?"',
  },
  {
    category: "organization",
    allowed: "Plan your story",
    avoid: '"Write the ending for me."',
    better: '"How can I organize the beginning, middle, and end?"',
  },
  {
    category: "language",
    allowed: "Get language help",
    avoid: '"Fix my paragraph."',
    better: '"What word can I use instead of \'very tired\'?"',
  },
  {
    category: "language",
    allowed: "Get short local feedback",
    avoid: '"Rewrite my paragraph."',
    better: '"Can you point out one awkward part in this paragraph?"',
  },
  {
    category: "comprehension",
    allowed: "Ask for a clearer explanation",
    avoid: '"??"',
    better: '"Explain the last point again more simply."',
  },
] as const;

function GuideContent() {
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
            Get short local feedback on flow, logic, or awkward wording
            <br />
            &quot;Which part sounds awkward here?&quot; / &quot;이 부분에서 어색한 곳 하나만 짚어줄래?&quot;
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
            Do not ask for full correction or rewriting
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

function CompactGuideNotice({ onOpenGuide }: { onOpenGuide: () => void }) {
  return (
    <div className="guidance-box compact-guidance">
      <p>
        This chatbot can help with story understanding, next-event ideas, structure,
        expressions, and short local feedback.
        <br />
        이야기를 이해하고, 다음 전개를 떠올리고, 구성을 정리하고, 표현을 찾고,
        짧은 피드백을 받는 데 사용할 수 있어요.
      </p>
      <p>
        It does not write the answer for you, rewrite the whole draft, or summarize the
        whole story.
        <br />
        대신 문단을 써주거나, 전체 글을 다시 써주거나, 전체 줄거리를 요약해주지는
        않아요.
      </p>
      <div className="compact-guidance-actions">
        <button type="button" className="secondary-button" onClick={onOpenGuide}>
          Open Full Guide
        </button>
      </div>
    </div>
  );
}

function CompactGuideNoticeV2({ onOpenGuide }: { onOpenGuide: () => void }) {
  return (
    <div className="guidance-box compact-guidance">
      <p>이 챗봇으로 할 수 있어요:</p>
      <ul className="guide-list compact-guide-list">
        <li>이야기 이해</li>
        <li>다음 전개 아이디어</li>
        <li>구조 정리</li>
        <li>표현 찾기</li>
        <li>짧은 피드백</li>
      </ul>
      <p>이건 안 돼요:</p>
      <ul className="guide-list compact-guide-list">
        <li>문단 대신 쓰기</li>
        <li>전체 글 다시 쓰기</li>
        <li>전체 줄거리 요약</li>
      </ul>
      <p>헷갈리면 이렇게 물어보세요:</p>
      <ul className="guide-list compact-guide-list">
        <li>"방금 말 다시 쉽게 설명해줘"</li>
        <li>"이 부분만 다시 말해줘"</li>
        <li>"어색한 곳 하나만 짚어줘"</li>
      </ul>
      <div className="compact-guidance-actions">
        <button type="button" className="secondary-button" onClick={onOpenGuide}>
          Open Full Guide
        </button>
      </div>
    </div>
  );
}

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
        <p className="guide-subtitle">2. How to Ask / 질문 방법</p>
        <div className="guide-request-table">
          <div className="guide-request-head">Categories</div>
          <div className="guide-request-head">⭕ Better</div>
          <div className="guide-request-head">Avoid</div>
          {GUIDE_REQUEST_ROWS.map((row) => (
            <div key={`${row.allowed}-${row.avoid}`} className="guide-request-row">
              <div
                className={`guide-request-cell guide-request-cell-${row.category}`}
                data-label="Categories"
              >
                {row.allowed}
              </div>
              <div className="guide-request-cell" data-label="⭕ Better">
                {row.better}
              </div>
              <div className="guide-request-cell" data-label="Avoid">
                {row.avoid}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="guide-subsection">
        <p className="guide-subtitle">3. Important Rules / {KO.rulesTitle}</p>
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
  const [selectedTask, setSelectedTask] = useState<TaskId>("task1");
  const [selectedCondition, setSelectedCondition] = useState<TaskCondition>("static");
  const [taskStates, setTaskStates] = useState<Record<TaskId, TaskChatState>>(
    createInitialTaskStates
  );
  const [participantId, setParticipantId] = useState("");
  const [participantInput, setParticipantInput] = useState("");
  const [guideAccepted, setGuideAccepted] = useState(false);
  const [guideChecked, setGuideChecked] = useState(false);
  const [showGuide, setShowGuide] = useState(true);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminResetCode, setAdminResetCode] = useState("");
  const [adminResetMessage, setAdminResetMessage] = useState("");
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const taskStatesRef = useRef(taskStates);
  const revealedAssistantIdsRef = useRef<Set<string>>(collectAssistantIds(taskStates));
  const inFlightRequestRef = useRef<AbortController | null>(null);
  const loadingTimeoutRef = useRef<number | null>(null);

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

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
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

  const send = async () => {
    if (!input.trim() || isLoading) {
      return;
    }

    const userText = input.trim();
    const currentState = taskStatesRef.current[selectedTask];
    const nextInteractionCount = currentState.interactionCount + 1;
    const userMessage: ChatMessage = {
      id: `${Date.now()}-user`,
      role: "user",
      text: userText,
    };

    setTaskStates((current) => ({
      ...current,
      [selectedTask]: {
        ...current[selectedTask],
        interactionCount: nextInteractionCount,
        transcriptSaved: false,
        messages: [...current[selectedTask].messages, userMessage],
      },
    }));

    setInput("");
    setIsLoading(true);

    const controller = new AbortController();
    inFlightRequestRef.current = controller;
    loadingTimeoutRef.current = window.setTimeout(() => {
      controller.abort();
    }, 15000);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          taskId: selectedTask,
          participantId,
          query: userText,
          recentMessages: currentState.messages
            .filter((message) => message.id !== "welcome")
            .slice(-4)
            .map(({ role, text }) => ({ role, text })),
          category: "Others",
          condition: selectedCondition,
          sessionId: currentState.sessionId,
          interactionCount: nextInteractionCount,
          sessionStartedAt: currentState.sessionStartedAt,
        }),
        signal: controller.signal,
      });

      const text = await res.text();
      const assistantMessage: ChatMessage = {
        id: `${Date.now()}-assistant`,
        role: "assistant",
        text,
      };

      setTaskStates((current) => ({
        ...current,
        [selectedTask]: {
          ...current[selectedTask],
          messages: [...current[selectedTask].messages, assistantMessage],
        },
      }));
    } catch (error) {
      console.error(error);
      const message =
        error instanceof Error && error.name === "AbortError"
          ? "The request took too long. Please try one shorter question."
          : "Error occurred.";

      setTaskStates((current) => ({
        ...current,
        [selectedTask]: {
          ...current[selectedTask],
          messages: [
            ...current[selectedTask].messages,
            {
              id: `${Date.now()}-assistant-error`,
              role: "assistant",
              text: message,
            },
          ],
        },
      }));
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

  const displayTaskLabel = selectedTask === "task2" ? "EP2" : "EP1";

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
            <p>Please read the guide before you begin.</p>
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

          <div className="guide-panel">
            <GuideContentV2 />
          </div>

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
              className="send-button"
              disabled={!guideChecked || !isParticipantReady}
              onClick={handleGuideConfirm}
            >
              Start / {KO.start}
            </button>
          </div>

          {!participantInput.trim() ? (
            <p className="guide-warning">{KO.participantNeed}</p>
          ) : !isParticipantReady ? (
            <p className="guide-warning">{KO.participantFormat}</p>
          ) : null}
        </section>
      ) : (
        <section className="chat-card">
          <div className="chat-header">
            <div>
              <div className="task-display-pill">{displayTaskLabel}</div>
              <h1>My Writing Assistant</h1>
              <p className="participant-caption">Participant ID: {participantId}</p>
            </div>

            <div className="chat-header-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={returnToHomeScreen}
              >
                Go to Home
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowGuide(true)}
              >
                Read Guide Again
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setShowAdminPanel((current) => !current);
                  setAdminResetMessage("");
                }}
              >
                Administrator
              </button>
            </div>
          </div>

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
            <p className="section-label">Conversation</p>
            <div className="message-thread">
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
                    <div className="message-text">{message.text}</div>
                  </div>
                </div>
              ))}
              {isLoading ? (
                <div className="message-row message-row-assistant message-row-enter">
                  <div className="message-bubble message-bubble-assistant">
                    <div className="message-role">Assistant</div>
                    <div className="message-text message-text-thinking">Thinking...</div>
                  </div>
                </div>
              ) : null}
              <div ref={threadEndRef} />
            </div>
            <div className="composer-inline">
              <div className="example-prompt-panel" aria-label="Question examples">
                <p className="example-prompt-title">
                  {COMPOSER_HELP_TITLE}
                  <span className="example-prompt-title-ko">{COMPOSER_HELP_TITLE_KO}</span>
                </p>
                <p className="example-prompt-help">
                  {COMPOSER_HELP_TEXT}
                  <span className="example-prompt-help-ko">{COMPOSER_HELP_TEXT_KO}</span>
                </p>
                <div className="example-prompt-list">
                  {CHAT_EXAMPLE_PROMPTS.map((example) => (
                    <button
                      key={example.en}
                      type="button"
                      className={`example-prompt-button example-prompt-button-${example.category.toLowerCase()}`}
                      onClick={() => setInput(example.ko)}
                    >
                      <span className={`example-prompt-chip example-prompt-chip-${example.category.toLowerCase()}`}>
                        {example.category}
                      </span>
                      <span className="example-prompt-button-en">{example.en}</span>
                      <span className="example-prompt-button-ko">{example.ko}</span>
                    </button>
                  ))}
                </div>
              </div>

              <textarea
                id="chat-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                rows={4}
                className="chat-input"
                placeholder={CHAT_INPUT_PLACEHOLDER}
              />

              <div className="composer-footer">
                <button onClick={send} disabled={isLoading} className="send-button">
                  {isLoading ? "Sending... | \uBCF4\uB0B4\uB294 \uC911..." : "Send | \uBCF4\uB0B4\uAE30"}
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
                <h2>Quick Guide</h2>
              </div>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowGuide(false)}
              >
                Close
              </button>
            </div>

            <div className="guide-panel modal-guide-panel">
              <GuideContentV2 />
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
