"use client";

import { useState } from "react";
import Link from "next/link";
import type { ArchiveSession } from "@/backend/logs/historyArchive";
import { renderAssistantText } from "../ChatMessageContent";
import styles from "./history.module.css";
import ShareControls from "./ShareControls";

export default function HistoryViewer({ adminEmail }: { adminEmail: string }) {
  const [participant, setParticipant] = useState("P44");
  const [loadedParticipant, setLoadedParticipant] = useState("");
  const [sessions, setSessions] = useState<ArchiveSession[]>([]);
  const [task, setTask] = useState("task2");
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const filtered = sessions.filter((session) => session.taskId === task);
  const active = filtered.find((session) => session.sessionId === selected) || filtered[0];

  async function logout() {
    setSessions([]);
    setLoadedParticipant("");
    try {
      const response = await fetch("/api/history/auth", { method: "DELETE" });
      if (!response.ok) throw new Error();
      window.location.replace("/history/login");
    } catch { setError("로그아웃하지 못했습니다. 연결을 확인하고 다시 시도해 주세요."); }
  }

  async function loadHistory(event: React.FormEvent) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    setWarnings([]);
    setSessions([]);
    setLoadedParticipant("");
    setSelected("");
    try {
      const response = await fetch(`/api/history?participant=${encodeURIComponent(participant.trim())}`, { cache: "no-store" });
      const data = await response.json();
      if (response.status === 401) {
        window.location.replace("/history/login");
        return;
      }
      if (!response.ok) throw new Error(data.error || "기록을 불러오지 못했습니다.");
      setSessions(data.sessions);
      setLoadedParticipant(data.participantId);
      setWarnings(data.warnings || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "기록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="chat-shell">
      <section className={`chat-card chat-card-active ${styles.card}`}>
        <div className="chat-header">
          <div className="chat-title-group">
            <h1>My Writing Assistant</h1>
            <p className="chat-session-caption">이전 대화 · 읽기 전용</p>
          </div>
          <div className={styles.account}>
            <span>{adminEmail}</span>
            <button onClick={logout} disabled={loading} type="button">로그아웃</button>
            <Link href="/" className={styles.home}>참가자용 챗봇으로 돌아가기</Link>
          </div>
        </div>
        <form onSubmit={loadHistory} className={styles.controls}>
          <label>Participant ID
            <input value={participant} onChange={(event) => setParticipant(event.target.value.toUpperCase())}
              required pattern="[Pp][0-9]{2,}" disabled={loading} />
          </label>
          <button type="submit" disabled={loading}>{loading ? "불러오는 중…" : "기록 불러오기"}</button>
          <label>Story
            <select value={task} onChange={(event) => { setTask(event.target.value); setSelected(""); }}>
              <option value="task1">Story A</option><option value="task2">Story B</option>
            </select>
          </label>
          {filtered.length > 0 && <label className={styles.session}>Session
            <select value={active?.sessionId || ""} onChange={(event) => setSelected(event.target.value)}>
              {filtered.map((session) => <option key={session.sessionId} value={session.sessionId}>
                {session.timestamp ? new Date(session.timestamp).toLocaleString("ko-KR") : "날짜 없음"} · {session.sessionId}
              </option>)}
            </select>
          </label>}
        </form>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {warnings.map((warning, index) => <p className={styles.error} role="alert" key={index}>{warning}</p>)}
        {active && <p className={styles.caption}>
          {task === "task1" ? "Story A" : "Story B"} / Participant no.: {loadedParticipant}
          {` · ${active.messages.length}개 메시지`}
        </p>}
        {active && <ShareControls key={`${loadedParticipant}:${task}:${active.sessionId}`}
          participantId={loadedParticipant} taskId={active.taskId} sessionId={active.sessionId} />}
        <section className="thread-section" aria-label="이전 대화">
          <div key={`${loadedParticipant}:${task}:${active?.sessionId || ""}`} className="message-thread" aria-busy={loading}>
            {!active && !error && <p role="status" className={styles.empty}>
              {loading ? "Supabase에서 대화 기록을 불러오고 있습니다."
                : loadedParticipant
                  ? `${loadedParticipant}의 ${task === "task1" ? "Story A" : "Story B"} 기록이 없습니다. 다른 Story도 확인해 주세요.`
                  : "참가자 ID를 입력하고 ‘기록 불러오기’를 눌러 주세요."}
            </p>}
            {active?.messages.map((message, index) => (
              <div key={index} className={`message-row message-row-${message.role}`}>
                <div className={`message-bubble message-bubble-${message.role}`}>
                  <div className="message-role">{message.role === "user" ? "You" : "Assistant"}</div>
                  <div className="message-text">{message.role === "assistant" ? renderAssistantText(message.text) : message.text}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
