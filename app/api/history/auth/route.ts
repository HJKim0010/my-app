import { allowedEmail, authClient, authConfigured, privateHeaders, readSession, sameOrigin, sessionCookie, verifiedAdmin } from "../../../../backend/auth/historyAuth.ts";

export async function POST(request: Request) {
  if (!sameOrigin(request, true)) return Response.json({ error: "허용되지 않은 요청입니다." }, { status: 403, headers: privateHeaders });
  if (!authConfigured()) return Response.json({ error: "관리자 로그인이 아직 설정되지 않았습니다." }, { status: 503, headers: privateHeaders });
  let body;
  try {
    if (!request.headers.get("content-type")?.includes("application/json")) throw new Error();
    const text = await request.text();
    if (text.length > 4096) throw new Error();
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "이메일과 비밀번호를 확인해 주세요." }, { status: 400, headers: privateHeaders });
  }
  if (!allowedEmail(body?.email) || typeof body?.password !== "string" || !body.password || body.password.length > 1024) {
    return Response.json({ error: "이메일 또는 비밀번호를 확인해 주세요." }, { status: 401, headers: privateHeaders });
  }
  try {
    const { data, error } = await authClient().auth.signInWithPassword({ email: body.email.trim(), password: body.password });
    if (error && (error.status === 0 || (error.status ?? 0) >= 500 || error.name === "AuthRetryableFetchError" || error.code === "unexpected_failure")) {
      return Response.json({ error: "로그인 서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요." }, { status: 503, headers: privateHeaders });
    }
    if (error || !data.session || !data.user?.email_confirmed_at || !allowedEmail(data.user.email)) {
      const rateLimited = error?.status === 429;
      return Response.json({ error: rateLimited ? "로그인 시도가 많습니다. 잠시 후 다시 시도해 주세요." : "이메일 또는 비밀번호를 확인해 주세요." }, { status: rateLimited ? 429 : 401, headers: privateHeaders });
    }
    return Response.json({ ok: true }, { headers: {
      ...privateHeaders, "Set-Cookie": sessionCookie(data.session.access_token, data.session.expires_in),
    } });
  } catch {
    return Response.json({ error: "로그인 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요." }, { status: 503, headers: privateHeaders });
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request, true)) return Response.json({ error: "허용되지 않은 요청입니다." }, { status: 403, headers: privateHeaders });
  const token = readSession(request);
  if (await verifiedAdmin(token)) {
    try { await authClient().auth.admin.signOut(token, "local"); } catch { /* Still clear this browser's cookie. */ }
  }
  return Response.json({ ok: true }, { headers: { ...privateHeaders, "Set-Cookie": sessionCookie("", 0) } });
}
