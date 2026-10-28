import type { Metadata } from "next";
import LoginForm from "./LoginForm";

export const metadata: Metadata = { title: "선생님 로그인 | My Writing Assistant", robots: { index: false, follow: false } };

export default function LoginPage() {
  return <LoginForm />;
}
