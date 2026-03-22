"use client";

import { useEffect, useRef, useState } from "react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export default function Home() {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedCondition, setSelectedCondition] = useState("static");
  const [sessionId, setSessionId] = useState("");
  const [sessionStartedAt, setSessionStartedAt] = useState(0);
  const [interactionCount, setInteractionCount] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      text:
        "Ask about the assigned source, possible ideas, organization, or useful words and expressions. I will stay within the task materials and the writing-support rules.",
    },
  ]);
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef(messages);
  const interactionCountRef = useRef(interactionCount);
  const sessionIdRef = useRef(sessionId);
  const sessionStartedAtRef = useRef(sessionStartedAt);
  const selectedConditionRef = useRef(selectedCondition);
  const transcriptSavedRef = useRef(false);

  useEffect(() => {
    const conditionParam = new URLSearchParams(window.location.search).get("condition");
    setSelectedCondition(conditionParam === "dynamic" ? "dynamic" : "static");
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    interactionCountRef.current = interactionCount;
  }, [interactionCount]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    sessionStartedAtRef.current = sessionStartedAt;
  }, [sessionStartedAt]);

  useEffect(() => {
    selectedConditionRef.current = selectedCondition;
  }, [selectedCondition]);

  useEffect(() => {
    const hasExistingSession = Boolean(sessionIdRef.current) && interactionCountRef.current > 0;

    if (hasExistingSession && !transcriptSavedRef.current) {
      void persistTranscript(
        messagesRef.current.map(({ role, text }) => ({ role, text })),
        interactionCountRef.current,
        true
      );
    }

    const nextSessionId = crypto.randomUUID();
    setSessionId(nextSessionId);
    setSessionStartedAt(Date.now());
    setInteractionCount(0);
    transcriptSavedRef.current = false;
  }, [selectedCondition]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const persistTranscript = async (
    transcript: Array<Pick<ChatMessage, "role" | "text">>,
    count: number,
    isFinal = false
  ) => {
    if (!sessionIdRef.current || count <= 0 || transcriptSavedRef.current) {
      return;
    }

    const payload = {
      sessionId: sessionIdRef.current,
      condition: selectedConditionRef.current,
      interactionCount: count,
      sessionStartedAt: sessionStartedAtRef.current,
      isFinal,
      messages: transcript,
    };

    try {
      if (isFinal && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        const blob = new Blob([JSON.stringify(payload)], {
          type: "application/json",
        });
        const accepted = navigator.sendBeacon("/api/session", blob);

        if (accepted) {
          transcriptSavedRef.current = true;
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
      transcriptSavedRef.current = true;
    } catch (error) {
      console.error("Failed to persist session transcript", error);
    }
  };

  useEffect(() => {
    const flushTranscript = () => {
      if (transcriptSavedRef.current || interactionCountRef.current <= 0) {
        return;
      }

      void persistTranscript(
        messagesRef.current.map(({ role, text }) => ({ role, text })),
        interactionCountRef.current,
        true
      );
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushTranscript();
      }
    };

    window.addEventListener("pagehide", flushTranscript);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      flushTranscript();
      window.removeEventListener("pagehide", flushTranscript);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const send = async () => {
    if (!input.trim()) {
      return;
    }

    const userText = input.trim();
    const nextInteractionCount = interactionCount + 1;
    const userMessage: ChatMessage = {
      id: `${Date.now()}-user`,
      role: "user",
      text: userText,
    };

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setIsLoading(true);
    setInteractionCount(nextInteractionCount);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: userText,
          category: "Others",
          condition: selectedCondition,
          sessionId,
          interactionCount: nextInteractionCount,
          sessionStartedAt,
        }),
      });

      const text = await res.text();
      const assistantMessage: ChatMessage = {
        id: `${Date.now()}-assistant`,
        role: "assistant",
        text,
      };

      setMessages((current) => {
        return [...current, assistantMessage];
      });
    } catch (err) {
      console.error(err);
      setMessages((current) => {
        return [
          ...current,
          {
            id: `${Date.now()}-assistant-error`,
            role: "assistant" as const,
            text: "Error occurred.",
          },
        ];
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="chat-shell">
      <section className="chat-card">
        <div className="chat-header">
          <div>
            <span className="task-badge">Task 1</span>
            <h1>My Writing Assistant</h1>
          </div>
        </div>

        <div className="guidance-box">
          <p>
            This chatbot can <strong>help you understand the source</strong>,
            <strong> generate ideas</strong>,
            <strong> organize your writing</strong>, and
            <strong> find useful words or expressions</strong>.
          </p>
          <p>
            It <strong>cannot write sentences or paragraphs for you</strong>,
            <strong> correct or evaluate your draft</strong>, or
            <strong> summarize the whole source</strong>.
          </p>
          <p>
            Please use this chatbot to support your thinking and planning, not
            to replace your writing.
          </p>
        </div>

        <section className="thread-section">
          <p className="section-label">Conversation</p>
          <div className="message-thread">
            {messages.map((message) => (
              <div
                key={message.id}
                className={
                  message.role === "user"
                    ? "message-row message-row-user"
                    : "message-row message-row-assistant"
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
              <div className="message-row message-row-assistant">
                <div className="message-bubble message-bubble-assistant">
                  <div className="message-role">Assistant</div>
                  <div className="message-text">Thinking...</div>
                </div>
              </div>
            ) : null}
            <div ref={threadEndRef} />
          </div>
        </section>

        <section className="composer-section">
          <label className="section-label" htmlFor="chat-input">
            Ask about the assigned source
          </label>
          <textarea
            id="chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!isLoading) {
                  void send();
                }
              }
            }}
            rows={5}
            className="chat-input"
            placeholder="Ask about a scene, what a line means, possible ideas for the continuation, or useful words and expressions."
          />

          <div className="composer-footer">
            <button onClick={send} disabled={isLoading} className="send-button">
              {isLoading ? "Sending..." : "Send"}
            </button>
          </div>
        </section>
      </section>
    </main>
  );
}
