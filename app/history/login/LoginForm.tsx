"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "../history.module.css";

export default function LoginForm() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/history/auth", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: fields.get("email"), password: fields.get("password") }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "로그인하지 못했습니다.");
      form.reset();
      window.location.replace("/history");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "로그인하지 못했습니다.");
      setLoading(false);
    }
  }

  return <main className={styles.loginShell}>
    <section className={styles.loginCard}>
      <p className={styles.eyebrow}>MY WRITING ASSISTANT</p>
      <h1>선생님 로그인</h1>
      <p className={styles.loginDescription}>참가자의 이전 대화를 확인하세요.<br />허용된 선생님 계정으로만 이용할 수 있습니다.</p>
      <form onSubmit={login} className={styles.loginForm}>
        <label>이메일<input type="email" name="email" autoComplete="username" required maxLength={254} disabled={loading} /></label>
        <label>비밀번호<input type="password" name="password" autoComplete="current-password" required maxLength={1024} disabled={loading} /></label>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <button disabled={loading} type="submit">{loading ? "로그인 중…" : "로그인"}</button>
      </form>
      <Link href="/" className={styles.home}>참가자용 챗봇으로 돌아가기</Link>
    </section>
  </main>;
}
