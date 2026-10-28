import assert from "node:assert/strict";
import { GET } from "../app/api/history/route.ts";
import { POST, DELETE } from "../app/api/history/auth/route.ts";
import { sessionCookie, readSession, sameOrigin } from "../backend/auth/historyAuth.ts";

const savedEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const admin = { id: "teacher", email: "teacher@example.test", email_confirmed_at: "2026-09-01T00:00:00Z", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} };
const origin = "https://example.test";
const request = (path = "/api/history?participant=P44", token = "", options = {}) => new Request(origin + path, {
  ...options, headers: { origin, ...(token ? { cookie: `__Host-history-session=${token}` } : {}), ...options.headers },
});
let user = admin;
let valid = true;
let passwordOK = true;
let queries = 0;
let authFailureStatus = 0;
try {
  assert.equal(sameOrigin(new Request("http://localhost:3000/api/history/auth", { headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" } }), true), true);
  assert.equal(sameOrigin(new Request("http://localhost:3000/api/history/auth", { headers: { host: "127.0.0.1:3000", origin: "http://evil.test" } }), true), false);
  process.env.NODE_ENV = "production";
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
  process.env.HISTORY_ADMIN_EMAIL = admin.email;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/user") return valid ? Response.json(user) : Response.json({ msg: "invalid", code: "bad_jwt" }, { status: 401 });
    if (url.pathname === "/auth/v1/token" && authFailureStatus) return Response.json({ msg: "upstream unavailable", code: authFailureStatus === 429 ? "over_request_rate_limit" : "unexpected_failure" }, { status: authFailureStatus });
    if (url.pathname === "/auth/v1/token") return passwordOK
      ? Response.json({ user, access_token: "verified-token", refresh_token: "unused", token_type: "bearer", expires_in: 3600 })
      : Response.json({ msg: "bad credentials", code: "invalid_credentials" }, { status: 400 });
    if (url.pathname === "/auth/v1/logout") return new Response(null, { status: 204 });
    assert.equal(init.cache, "no-store");
    queries++;
    return Response.json(url.searchParams.get("offset") === "0" && url.pathname.endsWith("chat_events") ? [{
      id: 1, participant_id: "P44", session_id: "test-session", ep_id: "ep2", interaction_count: 1,
      raw_user_query: "question", assistant_response: "answer", timestamp: "2026-09-01T00:00:00Z",
    }] : []);
  };
  assert.equal((await GET(request())).status, 401, "unauthenticated production requests are denied");
  assert.equal(queries, 0, "authorization runs before reading research records");
  valid = false;
  assert.equal((await GET(request(undefined, "forged-token"))).status, 401);
  valid = true;
  user = { ...admin, email: "other@example.test" };
  assert.equal((await GET(request(undefined, "valid-other-user"))).status, 401, "a valid non-admin account cannot read history");
  user = { ...admin, email_confirmed_at: undefined };
  assert.equal((await GET(request(undefined, "unconfirmed"))).status, 401);
  user = admin;
  delete process.env.HISTORY_ADMIN_EMAIL;
  assert.equal((await GET(request(undefined, "verified-token"))).status, 401, "missing allowlist fails closed");
  process.env.HISTORY_ADMIN_EMAIL = admin.email;
  const result = await GET(request(undefined, "verified-token"));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).sessions[0].messages.length, 2);
  assert.equal(result.headers.get("cache-control"), "private, no-store");
  assert.equal((await GET(request(undefined, "verified-token", { headers: { origin: "https://evil.test" } }))).status, 403);
  assert.equal((await GET(request("/api/history?participant=invalid", "verified-token"))).status, 400);

  const login = (email = admin.email, headers = {}) => request("/api/history/auth", "", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ email, password: "test-password" }),
  });
  assert.equal((await POST(login("other@example.test"))).status, 401);
  assert.equal((await POST(login(admin.email, { origin: "https://evil.test" }))).status, 403);
  passwordOK = false;
  assert.equal((await POST(login())).status, 401);
  passwordOK = true;
  authFailureStatus = 503;
  const unavailable = await POST(login());
  assert.equal(unavailable.status, 503, "an upstream outage is not a bad-password response");
  assert.match((await unavailable.json()).error, /로그인 서비스/);
  assert.equal(unavailable.headers.get("set-cookie"), null);
  authFailureStatus = 429;
  assert.equal((await POST(login())).status, 429, "rate limits keep their specific retry message");
  authFailureStatus = 0;
  const signedIn = await POST(login());
  assert.equal(signedIn.status, 200);
  const cookie = signedIn.headers.get("set-cookie");
  for (const flag of ["__Host-history-session=", "HttpOnly", "Secure", "SameSite=Strict", "Path=/", "Max-Age=3600"]) assert.ok(cookie.includes(flag));
  assert.deepEqual(await signedIn.json(), { ok: true }, "tokens never appear in client JSON");
  assert.equal(readSession(request(undefined, "%invalid")), "");
  assert.ok(sessionCookie("token", 999999).includes("Max-Age=3600"));
  const signedOut = await DELETE(request("/api/history/auth", "verified-token", { method: "DELETE" }));
  assert.ok(signedOut.headers.get("set-cookie").includes("Max-Age=0"));
  process.env.NODE_ENV = "development";
  assert.equal((await GET(new Request("http://localhost:3000/api/history?participant=P44"))).status, 401, "local development has no authentication bypass");
} finally {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
}
console.log("History authentication and access-control checks passed.");
