"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
const STORAGE_KEY_PREFIX = "writing-assistant-task-state-v3";
const GUIDE_KEY_PREFIX = "writing-assistant-guide-accepted-v2";
const CURRENT_PARTICIPANT_KEY = "writing-assistant-current-participant-v1";

const KO = {
  intro:
    "\uC774 \uCC57\uBD07\uC740 \uAE00\uC744 \uB300\uC2E0 \uC368\uC8FC\uB294 \uB3C4\uAD6C\uAC00 \uC544\uB2D9\uB2C8\uB2E4. \uC774\uC57C\uAE30\uB97C \uC774\uD574\uD558\uACE0, \uC544\uC774\uB514\uC5B4\uB97C \uC0DD\uAC01\uD558\uACE0, \uAE00\uC744 \uACC4\uD68D\uD558\uACE0, \uC5B8\uC5B4 \uD45C\uD604\uC744 \uB3D5\uB294 \uB3C4\uAD6C\uC785\uB2C8\uB2E4.",
  support:
    "AI\uB294 \uC0DD\uAC01\uC744 \uB3D5\uACE0, \uAE00\uC740 \uC5EC\uB7EC\uBD84\uC774 \uC9C1\uC811 \uC791\uC131\uD574\uC57C \uD569\uB2C8\uB2E4.",
  languageTitle: "\uC0AC\uC6A9 \uAC00\uB2A5 \uC5B8\uC5B4",
  allowedTitle: "\uC774\uB807\uAC8C \uC0AC\uC6A9\uD558\uC138\uC694",
  restrictedTitle: "\uC774\uB807\uAC8C \uC0AC\uC6A9\uD558\uBA74 \uC548 \uB429\uB2C8\uB2E4",
  goodTitle: "\uC88B\uC740 \uC0AC\uC6A9 vs \uC798\uBABB\uB41C \uC0AC\uC6A9",
  rulesTitle: "\uC911\uC694\uD55C \uADDC\uCE59",
  q1: "\uC774 \uBD80\uBD84\uC740 \uBB34\uC2A8 \uB73B\uC778\uAC00\uC694?",
  q2: "\uB2E4\uC74C\uC5D0 \uC77C\uC5B4\uB0A0 \uC218 \uC788\uB294 \uC77C\uC744 \uC0DD\uAC01\uD574 \uBCFC \uC218 \uC788\uB098\uC694?",
  q3: "\uAE00\uC758 \uC2DC\uC791-\uC911\uAC04-\uB05D\uC744 \uC5B4\uB5BB\uAC8C \uC9DC\uBA74 \uC88B\uC744\uAE4C\uC694?",
  q4: "'very tired' \uB300\uC2E0 \uC4F8 \uC218 \uC788\uB294 \uB2E4\uB978 \uB2E8\uC5B4\uB294 \uBB34\uC5C7\uC778\uAC00\uC694?",
  r1: "\uB2E4\uC74C \uBB38\uB2E8\uC744 \uC368 \uC918.",
  r2: "\uB2F5\uC548\uC744 \uB2E4 \uC368 \uC918.",
  r3: "\uC774 \uBB38\uC7A5\uC744 \uACE0\uCCD0 \uC918.",
  r4: "\uC774\uC57C\uAE30 \uC804\uCCB4\uB97C \uC694\uC57D\uD574 \uC918.",
  r5: "\uB354 \uD765\uBBF8\uB86D\uAC8C \uB298\uB824 \uC918.",
  lang: "\uC9C8\uBB38\uC740 \uD55C\uAD6D\uC5B4, \uC601\uC5B4, \uB610\uB294 \uB458 \uB2E4 \uC0AC\uC6A9\uD574\uB3C4 \uB429\uB2C8\uB2E4.",
  one: "\uD55C \uBC88\uC5D0 \uD55C \uAC00\uC9C0\uC529 \uBD84\uBA85\uD558\uAC8C \uC9C8\uBB38\uD558\uC138\uC694.",
  refuse:
    "\uCC57\uBD07\uC774 \uAC70\uC808\uD55C \uC694\uCCAD\uC740 \uD45C\uD604\uB9CC \uBC14\uAFD4\uC11C \uB2E4\uC2DC \uC2DC\uB3C4\uD558\uC9C0 \uB9C8\uC138\uC694.",
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
      "Hello. I can help you understand the story, think of next ideas, plan your writing, and find useful words, expressions, or language help. Ask one thing at a time, and we can work through it together.",
  };
}

function createTaskState(): TaskChatState {
  return {
    sessionId: crypto.randomUUID(),
    sessionStartedAt: Date.now(),
    interactionCount: 0,
    transcriptSaved: false,
    messages: [buildWelcomeMessage()],
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
        messages: candidate.messages
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
          })),
      };

      if (next[taskId].messages.length === 0) {
        next[taskId].messages = [buildWelcomeMessage()];
      }
    }

    return next;
  } catch {
    return createInitialTaskStates();
  }
}

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
            "What does this part mean?" / "{KO.q1}"
          </li>
          <li>
            Get ideas
            <br />
            "Can you help me think of possible next events?" / "{KO.q2}"
          </li>
          <li>
            Plan your story
            <br />
            "How can I plan my story?" / "{KO.q3}"
          </li>
          <li>
            Get word, expression, or language help
            <br />
            "What word can I use instead of 'very tired'?" / "{KO.q4}"
          </li>
        </ul>
      </div>

      <div className="guide-subsection">
        <p className="guide-subtitle">3. Restricted Use / {KO.restrictedTitle}</p>
        <ul className="guide-list guide-list-numbered">
          <li>
            Do not ask the chatbot to write for you
            <br />
            "Write the next paragraph." / "{KO.r1}"
          </li>
          <li>
            Do not ask for a full answer
            <br />
            "Give me a full answer." / "{KO.r2}"
          </li>
          <li>
            Do not ask for correction or rewriting
            <br />
            "Fix my sentences." / "{KO.r3}"
          </li>
          <li>
            Do not ask for a whole-source summary
            <br />
            "Summarize the story." / "{KO.r4}"
          </li>
          <li>
            Do not ask it to add more content for you
            <br />
            "Make it more interesting." / "{KO.r5}"
          </li>
        </ul>
      </div>

      <div className="guide-subsection">
        <p className="guide-subtitle">4. Good Use vs Wrong Use / {KO.goodTitle}</p>
        <div className="guide-compare">
          <div className="guide-compare-head guide-compare-wrong">Wrong / 잘못된 사용</div>
          <div className="guide-compare-head guide-compare-right">Better / 더 좋은 사용</div>
          <div className="guide-compare-cell">"Write the ending."</div>
          <div className="guide-compare-cell">"What are 2 possible endings?"</div>
          <div className="guide-compare-cell">"Summarize the story."</div>
          <div className="guide-compare-cell">"What problem does the character face?"</div>
          <div className="guide-compare-cell">"Fix my paragraph."</div>
          <div className="guide-compare-cell">"What word can I use instead of 'very tired'?"</div>
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
  const [typingMessageId, setTypingMessageId] = useState<string | null>(null);
  const [typingText, setTypingText] = useState("");
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminResetCode, setAdminResetCode] = useState("");
  const [adminResetMessage, setAdminResetMessage] = useState("");
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const taskStatesRef = useRef(taskStates);
  const revealedAssistantIdsRef = useRef<Set<string>>(collectAssistantIds(taskStates));

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
    if (!guideAccepted) {
      return;
    }

    const lastMessage = activeTaskState.messages[activeTaskState.messages.length - 1];

    if (!lastMessage || lastMessage.role !== "assistant") {
      setTypingMessageId(null);
      setTypingText("");
      return;
    }

    if (revealedAssistantIdsRef.current.has(lastMessage.id)) {
      setTypingMessageId(null);
      setTypingText("");
      return;
    }

    setTypingMessageId(lastMessage.id);
    setTypingText("");

    const fullText = lastMessage.text;
    let index = 0;
    const step = fullText.length > 220 ? 3 : fullText.length > 120 ? 2 : 1;
    const timer = window.setInterval(() => {
      index = Math.min(index + step, fullText.length);
      setTypingText(fullText.slice(0, index));

      if (index >= fullText.length) {
        window.clearInterval(timer);
        revealedAssistantIdsRef.current.add(lastMessage.id);
        setTypingMessageId(null);
      }
    }, 16);

    return () => window.clearInterval(timer);
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
    setTypingMessageId(null);
    setTypingText("");

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

  const persistTranscript = async (taskId: TaskId, state: TaskChatState, isFinal = false) => {
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
      messages: state.messages.map<StoredTranscriptMessage>(({ role, text }) => ({ role, text })),
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
  };

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
  }, [participantId, selectedCondition]);

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
          category: "Others",
          condition: selectedCondition,
          sessionId: currentState.sessionId,
          interactionCount: nextInteractionCount,
          sessionStartedAt: currentState.sessionStartedAt,
        }),
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
      setTaskStates((current) => ({
        ...current,
        [selectedTask]: {
          ...current[selectedTask],
          messages: [
            ...current[selectedTask].messages,
            {
              id: `${Date.now()}-assistant-error`,
              role: "assistant",
              text: "Error occurred.",
            },
          ],
        },
      }));
    } finally {
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
    setTypingMessageId(null);
    setTypingText("");
  };

  const taskLabel = selectedTask === "task2" ? "Task 2" : "Task 1";

  const clearSavedLocalLogs = () => {
    if (adminResetCode !== "0784") {
      setAdminResetMessage("Password does not match.");
      return;
    }

    const keysToRemove: string[] = [];

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);

      if (
        key &&
        (key.startsWith(`${STORAGE_KEY_PREFIX}:`) || key.startsWith(`${GUIDE_KEY_PREFIX}:`))
      ) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      window.localStorage.removeItem(key);
    }

    window.localStorage.removeItem(CURRENT_PARTICIPANT_KEY);

    const initialStates = createInitialTaskStates();
    setTaskStates(initialStates);
    taskStatesRef.current = initialStates;
    revealedAssistantIdsRef.current = collectAssistantIds(initialStates);
    setParticipantId("");
    setParticipantInput("");
    setGuideAccepted(false);
    setGuideChecked(false);
    setShowGuide(true);
    setTypingMessageId(null);
    setTypingText("");
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
            <GuideContent />
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
              <div className="task-display-pill">{taskLabel}</div>
              <h1>My Writing Assistant</h1>
              <p className="participant-caption">Participant ID: {participantId}</p>
            </div>

            <div className="chat-header-actions">
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
                    <div className="message-text">
                      {message.role === "assistant" && typingMessageId === message.id ? (
                        <>
                          {typingText}
                          <span className="typing-caret" aria-hidden="true" />
                        </>
                      ) : (
                        message.text
                      )}
                    </div>
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
                placeholder="Ask what a part means, what could happen next, how to plan your writing, or what words, expressions, and language help might help."
              />

              <div className="composer-footer">
                <button onClick={send} disabled={isLoading} className="send-button">
                  {isLoading ? "Sending..." : "Send"}
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
              <GuideContent />
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
