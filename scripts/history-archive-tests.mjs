import assert from "node:assert/strict";
import { buildArchiveSessions, readArchiveTable } from "../backend/logs/historyArchive.ts";


const row = { participant_id: "P44", session_id: "session-1", ep_id: "ep2", timestamp: "2026-09-21T10:00:00Z" };
const pair = [{ role: "user", text: "다시 설명해줘\n\n이 부분이야." }, { role: "assistant", text: "**첫 번째**\n\n- 설명" }];
const snapshots = [
  { ...row, interaction_count: 1, transcript: pair },
  { ...row, interaction_count: 2, transcript: [...pair, ...pair] },
  { ...row, interaction_count: 2, transcript: [...pair, ...pair], timestamp: "2026-09-21T10:01:00Z" },
];
const events = [1, 2, 3].map((interaction_count) => ({ ...row, interaction_count, raw_user_query: pair[0].text, assistant_response: pair[1].text }));
let result = buildArchiveSessions(snapshots, events, "P44");
assert.equal(result.length, 1);
assert.deepEqual(result[0].messages, [...pair, ...pair, ...pair], "snapshots are not concatenated; later turns append without collapsing repeated text");
assert.equal(result[0].taskId, "task2");
assert.deepEqual(buildArchiveSessions([], events, "P44")[0].messages, [...pair, ...pair, ...pair], "event-only sessions retain every turn");
assert.deepEqual(buildArchiveSessions(snapshots, [], "P44")[0].messages, [...pair, ...pair], "transcript-only sessions choose one complete snapshot");
const legacy = { ...row, ep_id: undefined, task_id: "task1", interaction_count: 1, raw_user_query: "Story A", assistant_response: "A" };
result = buildArchiveSessions(snapshots, [...events, legacy, { ...legacy, participant_id: "P45", session_id: "other" }], "P44");
assert.equal(result.length, 2, "stories stay separate, including legacy task IDs; another participant is excluded");
assert.equal(buildArchiveSessions([], [...events, { ...events[2], assistant_response: "retried", timestamp: "2026-09-21T10:02:00Z" }], "P44")[0].messages.at(-1).text, "retried");

const originalFetch = globalThis.fetch;
const savedEnv = { ...process.env };
try {
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    const query = new URL(url).searchParams;
    assert.equal(query.get("participant_id"), "eq.P44");
    assert.equal(options.cache, "no-store");
    assert.equal(options.method, undefined, "archive reads never write to Supabase");
    const offset = Number(query.get("offset"));
    calls++;
    return Response.json(events.slice(offset, offset + 1));
  };
  assert.deepEqual(await readArchiveTable("https://example.test", "test-key", "chat_events", "P44"), events);
  assert.equal(calls, 4, "pagination continues when the server returns fewer rows than requested");


} finally {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
}
console.log("History archive checks passed.");
