"use client";
import { useEffect, useState } from "react";
import styles from "./history.module.css";
import { formatShareDate, koreaLocalToIso, parseShareExpiry } from "../../backend/logs/shareExpiry";

type Share = { id: string; created_at: string; expires_at: string };
type Scope = { participantId: string; taskId: "task1" | "task2"; sessionId: string };

export default function ShareControls(scope: Scope) {
  const [duration, setDuration] = useState("1");
  const [customExpiry, setCustomExpiry] = useState("");
  const [shares, setShares] = useState<Share[]>([]);
  const [created, setCreated] = useState<{ id: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const { participantId, taskId, sessionId } = scope;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/history/shares?${new URLSearchParams({ participantId, taskId, sessionId })}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        setShares(data.shares);
      }).catch((cause) => { if (!controller.signal.aborted) setError(cause.message || "공유 링크를 불러오지 못했습니다."); });
    return () => controller.abort();
  }, [participantId, taskId, sessionId]);

  async function create() {
    setBusy(true); setError(""); setCopied(false);
    try {
      const expiry = duration === "custom" ? { expiresAt: koreaLocalToIso(customExpiry) } : { hours: Number(duration) };
      if (parseShareExpiry(expiry) === null) throw new Error("현재보다 이후의 만료 날짜와 시간을 선택해 주세요. (한국 시간)");
      const response = await fetch("/api/history/shares", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...scope, ...expiry }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setCreated({ id: data.id, url: `${window.location.origin}/shared#${data.token}` });
      setShares((previous) => [{ id: data.id, created_at: data.created_at, expires_at: data.expires_at }, ...previous]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "공유 링크를 만들지 못했습니다."); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/history/shares?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setShares((previous) => previous.filter((share) => share.id !== id));
      if (created?.id === id) setCreated(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "공유를 중지하지 못했습니다."); }
    finally { setBusy(false); }
  }

  return <details className={styles.sharePanel}>
    <summary>이 대화 공유하기</summary>
    <p>{participantId} · {taskId === "task1" ? "Story A" : "Story B"}의 선택한 세션만 읽기 전용으로 공유합니다. 링크를 가진 사람은 로그인 없이 볼 수 있습니다.</p>
    <p>링크는 생성 즉시 열리며, 만료 시각까지 보기만 가능합니다. 메시지 전송·수정·삭제·다른 대화 조회는 할 수 없습니다.</p>
    <div className={styles.controls}>
      <label>링크 유효 기간
        <select value={duration} onChange={(event) => setDuration(event.target.value)} disabled={busy}>
          {[1, 6, 12, 24].map((value) => <option key={value} value={value}>{value}시간</option>)}
          <option value="custom">만료 날짜·시간 직접 지정</option>
        </select>
      </label>
      {duration === "custom" && <label>만료 날짜·시간 (한국 시간)
        <input type="datetime-local" value={customExpiry} onChange={(event) => setCustomExpiry(event.target.value)} disabled={busy} required />
      </label>}
      <button type="button" onClick={create} disabled={busy}>{busy ? "처리 중…" : "공유 링크 만들기"}</button>
    </div>
    {created && <div className={styles.copyRow}>
      <input aria-label="공유 링크" value={created.url} readOnly onFocus={(event) => event.target.select()} />
      <button type="button" onClick={async () => {
        try { await navigator.clipboard.writeText(created.url); setCopied(true); }
        catch { setError("공유 링크 입력칸을 선택해 직접 복사해 주세요."); }
      }}>{copied ? "복사됨" : "링크 복사"}</button>
    </div>}
    {created && <p>이 화면을 닫기 전에 링크를 복사해 주세요. 나중에는 새 링크를 만들 수 있습니다.</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {shares.length > 0 && <ul className={styles.shareList}>
      {shares.map((share) => <li key={share.id}>
        <span>{formatShareDate(share.created_at)} 생성 · {formatShareDate(share.expires_at)} 만료 (한국 시간)</span>
        <button type="button" disabled={busy} onClick={() => revoke(share.id)}>사용 중지</button>
      </li>)}
    </ul>}
  </details>;
}
