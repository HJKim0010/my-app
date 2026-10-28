import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { GET, POST, DELETE } from "../app/api/history/shares/route.ts";
import { POST as readPublic } from "../app/api/shared/route.ts";
import { hashShareToken } from "../backend/logs/historyShares.ts";
import { koreaLocalToIso, parseShareExpiry, shareExpiryDelay } from "../backend/logs/shareExpiry.ts";

const savedEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const admin = { id: "teacher", email: "teacher@example.test", email_confirmed_at: "2026-09-01T00:00:00Z" };
const scope = { participantId: "P44", taskId: "task2", sessionId: "session-1" };
const messages = [{ role: "user", text: "repeat\n\nrepeat" }, { role: "assistant", text: "**answer**" }];
const rows = [];
let readCount = 0;
let validAdmin = true;
let sourceText = messages;
const req = (path, method = "GET", body, loggedIn = true, origin = "https://app.test") => new Request(`https://app.test${path}`, {
  method, headers: { origin, "Content-Type": "application/json", ...(loggedIn ? { cookie: "__Host-history-session=test-session" } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});
const summary = (row) => ({ id: row.id, created_at: row.created_at, expires_at: row.expires_at });
try {
  Object.assign(process.env, { NODE_ENV: "production", SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-key", HISTORY_ADMIN_EMAIL: admin.email });
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/auth/v1/user")) return Response.json(validAdmin ? admin : { ...admin, email: "other@example.test" });
    assert.equal(init.cache, "no-store");
    if (url.pathname.endsWith("session_transcripts")) return Response.json(url.searchParams.get("offset") === "0" ? [{
      participant_id: "P44", task_id: "task2", session_id: "session-1", timestamp: "2026-09-01T00:00:00Z", interaction_count: 1, transcript: sourceText,
    }, { participant_id: "P44", task_id: "task1", session_id: "other-session", transcript: [{ role: "user", text: "NEVER SHARE THIS" }] }] : []);
    if (url.pathname.endsWith("chat_events")) return Response.json([]);
    assert.ok(url.pathname.endsWith("history_share_links"));
    readCount++;
    if (init.method === "POST") {
      const row = { ...JSON.parse(init.body), id: randomUUID(), revoked_at: null };
      rows.push(row);
      return Response.json(summary(row));
    }
    let found = rows.filter((row) => Array.from(url.searchParams).every(([key, filter]) => {
      if (filter.startsWith("eq.")) return String(row[key]) === filter.slice(3);
      if (filter === "is.null") return row[key] === null;
      if (filter.startsWith("gt.")) return row[key] > filter.slice(3);
      return true;
    }));
    if (init.method === "PATCH") {
      for (const row of found) Object.assign(row, JSON.parse(init.body));
      return new Response(null, { status: 204 });
    }
    const fields = url.searchParams.get("select").split(",");
    found = found.map((row) => Object.fromEntries(fields.map((field) => [field, row[field]])));
    return Response.json(found);
  };

  assert.equal((await POST(req("/api/history/shares", "POST", { ...scope, hours: 1 }, false))).status, 401);
  assert.equal(readCount, 0, "anonymous callers cannot list or create links");
  assert.equal((await POST(req("/api/history/shares", "POST", { ...scope, hours: 1 }, true, "https://evil.test"))).status, 403);
  validAdmin = false;
  assert.equal((await POST(req("/api/history/shares", "POST", { ...scope, hours: 1 }))).status, 401);
  validAdmin = true;
  assert.equal((await POST(req("/api/history/shares", "POST", { ...scope, hours: 9999 }))).status, 400);
  assert.equal((await POST(req("/api/history/shares", "POST", { ...scope, sessionId: "missing", hours: 1 }))).status, 503);
  assert.equal(rows.length, 0, "a nonexistent session never creates a link");

  const response = await POST(req("/api/history/shares", "POST", scope));
  assert.equal(response.status, 200);
  const share = await response.json();
  assert.equal(share.token.length, 43);
  assert.equal(Date.parse(share.expires_at) - Date.parse(share.created_at), 3600000);
  for (const hours of [2, 25, 168, 0, -1, 1.5, "1", null]) {
    assert.equal((await POST(req("/api/history/shares", "POST", { ...scope, hours }))).status, 400);
  }
  assert.equal(rows[0].token_hash, hashShareToken(share.token));
  assert.ok(!JSON.stringify(rows).includes(share.token), "only a token hash is stored");
  assert.deepEqual(rows[0].snapshot.messages, messages);
  sourceText = [{ role: "assistant", text: "new later message" }];
  const publicResponse = await readPublic(req("/api/shared", "POST", { token: share.token }, false));
  assert.equal(publicResponse.status, 200, "a recipient needs no admin session");
  assert.equal(publicResponse.headers.get("Cache-Control"), "private, no-store");
  const publicData = await publicResponse.json();
  assert.deepEqual(publicData.conversation.messages, messages, "shared data is frozen when the link is created");
  assert.ok(!JSON.stringify(publicData).includes("NEVER SHARE THIS"));
  assert.ok(!JSON.stringify(publicData).includes(admin.email));
  assert.ok(!JSON.stringify(publicData).includes(rows[0].token_hash));
  assert.equal((await readPublic(req("/api/shared", "POST", { token: share.token.slice(0, -1) }, false))).status, 404);
  assert.equal((await readPublic(req("/api/shared", "POST", { token: "x".repeat(43) }, false))).status, 404);
  // A share token grants no management powers, even if supplied to those endpoints.
  assert.equal((await GET(req(`/api/history/shares?${new URLSearchParams({ ...scope, token: share.token })}`, "GET", undefined, false))).status, 401);
  assert.equal((await POST(req("/api/history/shares", "POST", { ...scope, token: share.token }, false))).status, 401);
  const before = structuredClone(rows[0]);
  await readPublic(req("/api/shared", "POST", { token: share.token, participantId: "P99", messages: [], snapshot: {} }, false));
  assert.deepEqual(rows[0], before, "public reads cannot alter shared data or scope");
  const metadata = await (await readPublic(req("/api/shared", "POST", { token: share.token, checkOnly: true }, false))).json();
  assert.deepEqual(Object.keys(metadata), ["expiresAt"]);
  const listing = await GET(req(`/api/history/shares?${new URLSearchParams(scope)}`));
  assert.deepEqual((await listing.json()).shares, [summary(rows[0])]);
  // A custom date keeps its exact deadline, including after the first 24 hours.
  const customDeadline = koreaLocalToIso("2099-10-10T16:00");
  assert.equal(customDeadline, "2099-10-10T07:00:00.000Z");
  assert.equal(koreaLocalToIso("2099-02-30T16:00"), null);
  assert.equal(koreaLocalToIso("2099-10-10T25:00"), null);
  assert.equal(koreaLocalToIso(""), null);
  assert.equal(parseShareExpiry({ expiresAt: customDeadline }, Date.parse(customDeadline)), null);
  assert.equal(shareExpiryDelay(customDeadline, Date.parse(customDeadline) - 1000), 1000);
  assert.equal(shareExpiryDelay(customDeadline, Date.parse(customDeadline)), 0);
  assert.equal(shareExpiryDelay(customDeadline, Date.parse(customDeadline) - 30 * 86400000), null);
  for (const expiresAt of [null, "", "bad", "2000-01-01T00:00:00.000Z", "2099-02-30T07:00:00.000Z", "2099-10-10T16:00"]) {
    assert.equal((await POST(req("/api/history/shares", "POST", { ...scope, expiresAt }))).status, 400);
  }
  assert.equal((await POST(req("/api/history/shares", "POST", { ...scope, hours: 1, expiresAt: customDeadline }))).status, 400);
  assert.equal((await POST(req("/api/history/shares", "POST", { ...scope, expiresAt: customDeadline }, false))).status, 401);
  const customResult = await POST(req("/api/history/shares", "POST", { ...scope, expiresAt: customDeadline }));
  assert.equal(customResult.status, 200);
  const custom = await customResult.json();
  assert.equal(custom.expires_at, customDeadline);
  const customRow = rows.find((row) => row.id === custom.id);
  customRow.created_at = new Date(Date.now() - 3 * 86400000).toISOString();
  for (const checkOnly of [false, true]) {
    const active = await readPublic(req("/api/shared", "POST", { token: custom.token, checkOnly }, false));
    assert.equal(active.status, 200);
    assert.equal((await active.json()).expiresAt, customDeadline);
  }
  assert.ok((await (await GET(req(`/api/history/shares?${new URLSearchParams(scope)}`))).json()).shares.some((row) => row.id === custom.id));
  customRow.expires_at = new Date(Date.now() - 1000).toISOString();
  for (const checkOnly of [false, true]) {
    assert.equal((await readPublic(req("/api/shared", "POST", { token: custom.token, checkOnly }, false))).status, 404);
  }
  customRow.expires_at = customDeadline;
  assert.equal((await DELETE(req(`/api/history/shares?id=${custom.id}`, "DELETE"))).status, 200);
  assert.equal((await readPublic(req("/api/shared", "POST", { token: custom.token }, false))).status, 404);
  rows[0].expires_at = "2000-01-01T00:00:00Z";
  // Every offered duration must survive beyond one hour when selected, and expire
  // at its own saved deadline in both full reads and periodic checks.
  for (const hours of [1, 6, 12, 24]) {
    const result = await POST(req("/api/history/shares", "POST", { ...scope, hours }));
    assert.equal(result.status, 200);
    const link = await result.json();
    assert.equal(Date.parse(link.expires_at) - Date.parse(link.created_at), hours * 3600000);
    const row = rows.find((item) => item.id === link.id);
    row.created_at = new Date(Date.now() - (hours - 0.5) * 3600000).toISOString();
    row.expires_at = new Date(Date.parse(row.created_at) + hours * 3600000).toISOString();
    for (const checkOnly of [false, true]) {
      const active = await readPublic(req("/api/shared", "POST", { token: link.token, checkOnly }, false));
      assert.equal(active.status, 200, `${hours}-hour link remains active until its chosen deadline`);
      assert.equal((await active.json()).expiresAt, row.expires_at);
    }
    assert.ok((await (await GET(req(`/api/history/shares?${new URLSearchParams(scope)}`))).json()).shares.some((item) => item.id === link.id));
    row.created_at = new Date(Date.now() - hours * 3600000 - 1000).toISOString();
    row.expires_at = new Date(Date.parse(row.created_at) + hours * 3600000).toISOString();
    for (const checkOnly of [false, true]) {
      assert.equal((await readPublic(req("/api/shared", "POST", { token: link.token, checkOnly }, false))).status, 404);
    }
    assert.ok(!(await (await GET(req(`/api/history/shares?${new URLSearchParams(scope)}`))).json()).shares.some((item) => item.id === link.id));
  }
  assert.deepEqual((await (await GET(req(`/api/history/shares?${new URLSearchParams(scope)}`))).json()).shares, []);
  rows[0].created_at = share.created_at;
  rows[0].expires_at = "2000-01-01T00:00:00Z";
  assert.equal((await readPublic(req("/api/shared", "POST", { token: share.token }, false))).status, 404);
  rows[0].expires_at = share.expires_at;
  assert.equal((await DELETE(req(`/api/history/shares?id=${share.id}`, "DELETE", undefined, false))).status, 401);
  assert.equal((await DELETE(req(`/api/history/shares?id=${share.id}`, "DELETE"))).status, 200);
  assert.deepEqual(rows[0].snapshot, {}, "revocation also removes the shared copy");
  assert.equal((await readPublic(req("/api/shared", "POST", { token: share.token }, false))).status, 404);
} finally {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
}
console.log("Share scope, snapshot, authentication, expiry and revocation checks passed.");
