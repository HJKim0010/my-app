"use client";
import { useEffect, useState } from "react";
import type { ArchiveMessage } from "@/backend/logs/historyArchive";
import { renderAssistantText } from "../ChatMessageContent";
import styles from "../history/history.module.css";
import { formatShareDate, shareExpiryDelay } from "../../backend/logs/shareExpiry";

type Conversation = { participantId: string; taskId: string; messages: ArchiveMessage[] };

export default function SharedConversation() {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let controller: AbortController | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    let expiryTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let generation = 0;
    const clearTimers = () => { if (interval) clearInterval(interval); if (expiryTimer) clearTimeout(expiryTimer); };
    function start() {
      const version = ++generation;
      clearTimers(); controller?.abort();
      setConversation(null); setExpiresAt(""); setError("");
      const token = window.location.hash.slice(1);
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { setError("공유 링크 전체를 열어 주세요. 선생님에게 받은 링크의 # 뒤 부분도 필요합니다."); return; }
      let loaded = false;
      const check = async () => {
        if (controller && !controller.signal.aborted) return;
        const pending = new AbortController(); controller = pending;
        const timeout = setTimeout(() => pending.abort(), 15000);
        try {
          const response = await fetch("/api/shared", {
            method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
            credentials: "omit", body: JSON.stringify({ token, checkOnly: loaded }), signal: pending.signal,
          });
          const data = await response.json();
          if (disposed || version !== generation) return;
          if (!response.ok) throw new Error(data.error || "공유된 대화를 불러오지 못했습니다.");
          if (!loaded) { setConversation(data.conversation); setExpiresAt(data.expiresAt); loaded = true; }
          if (expiryTimer) clearTimeout(expiryTimer);
          const delay = shareExpiryDelay(data.expiresAt);
          if (delay !== null) expiryTimer = setTimeout(() => { setConversation(null); setError("공유 기간이 만료되었습니다."); clearTimers(); }, delay);
        } catch (cause) {
          if (!disposed && version === generation) {
            setConversation(null);
            setError(cause instanceof Error && cause.name !== "AbortError" ? cause.message : "연결을 확인하고 새로고침해 주세요.");
            clearTimers();
          }
        } finally { clearTimeout(timeout); if (controller === pending) controller = null; }
      };
      void check();
      interval = setInterval(() => { void check(); }, 30000);
    }
    start();
    window.addEventListener("hashchange", start);
    return () => { disposed = true; generation++; controller?.abort(); clearTimers(); window.removeEventListener("hashchange", start); };
  }, []);

  return <main className="chat-shell">
    <section className={`chat-card chat-card-active ${styles.card}`}>
      <div className="chat-header"><div className="chat-title-group">
        <h1>My Writing Assistant</h1><p className="chat-session-caption">공유된 대화 · 읽기 전용</p>
      </div></div>
      {conversation && <p className={styles.caption}>
        {conversation.participantId} · {conversation.taskId === "task1" ? "Story A" : "Story B"} · {conversation.messages.length}개 메시지
        {expiresAt && ` · ${formatShareDate(expiresAt)}까지 열람 가능 (한국 시간)`}
      </p>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <section className="thread-section" aria-label="공유된 대화">
        <div className="message-thread">
          {!conversation && !error && <p className={styles.empty} role="status">대화를 불러오는 중입니다…</p>}
          {conversation?.messages.map((message, index) => <div key={index} className={`message-row message-row-${message.role}`}>
            <div className={`message-bubble message-bubble-${message.role}`}>
              <div className="message-role">{message.role === "user" ? "You" : "Assistant"}</div>
              <div className="message-text">{message.role === "assistant" ? renderAssistantText(message.text) : message.text}</div>
            </div>
          </div>)}
        </div>
      </section>
    </section>
  </main>;
}
