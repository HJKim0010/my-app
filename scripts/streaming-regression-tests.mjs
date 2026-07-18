import assert from "node:assert/strict";
import {
  flushChatStreamBuffer,
  parseChatStreamChunk,
} from "../app/chatStreamEvents.ts";

function eventLine(event) {
  return `${JSON.stringify(event)}\n`;
}

const multiEventChunk = [
  eventLine({ type: "start", requestId: "req-1" }),
  eventLine({ type: "delta", delta: "Hello " }),
  eventLine({ type: "delta", delta: "**world" }),
].join("");
const parsedMulti = parseChatStreamChunk("", multiEventChunk);
assert.equal(parsedMulti.events.length, 3, "multiple NDJSON events in one chunk are all parsed");
assert.equal(parsedMulti.events[1].type, "delta");
assert.equal(parsedMulti.events[1].delta, "Hello ");
assert.equal(parsedMulti.events[2].delta, "**world");
assert.equal(parsedMulti.buffer, "");

const splitLine = eventLine({ type: "delta", delta: " split-event" });
const firstHalf = splitLine.slice(0, 15);
const secondHalf = splitLine.slice(15);
const parsedFirstHalf = parseChatStreamChunk("", firstHalf);
assert.equal(parsedFirstHalf.events.length, 0, "split NDJSON event waits for the next chunk");
assert.equal(parsedFirstHalf.buffer, firstHalf);
const parsedSecondHalf = parseChatStreamChunk(parsedFirstHalf.buffer, secondHalf);
assert.equal(parsedSecondHalf.events.length, 1, "split NDJSON event is reconstructed");
assert.equal(parsedSecondHalf.events[0].type, "delta");
assert.equal(parsedSecondHalf.events[0].delta, " split-event");

let displayedText = "";
let assistantMessageCount = 1;
let finalized = false;
for (const event of parseChatStreamChunk(
  "",
  [
    eventLine({ type: "delta", delta: "First " }),
    eventLine({ type: "delta", delta: "second" }),
    eventLine({ type: "done", payload: { text: "First second", status: "success" } }),
  ].join("")
).events) {
  if (event.type === "delta") {
    displayedText += event.delta;
  }
  if (event.type === "done") {
    finalized = true;
  }
}
assert.equal(assistantMessageCount, 1, "stream updates one assistant message");
assert.equal(displayedText, "First second", "final text equals concatenated deltas");
assert.equal(finalized, true, "stream finalizes exactly once");

const interruptedEvents = parseChatStreamChunk(
  "",
  [
    eventLine({ type: "delta", delta: "Partial **markdown" }),
    eventLine({ type: "error", payload: { text: "timeout", status: "timeout", reason: "timeout" } }),
  ].join("")
).events;
let interruptedVisibleText = "";
let interrupted = false;
for (const event of interruptedEvents) {
  if (event.type === "delta") {
    interruptedVisibleText += event.delta;
  }
  if (event.type === "error") {
    interrupted = true;
  }
}
assert.equal(interruptedVisibleText, "Partial **markdown", "interruption preserves visible partial text");
assert.equal(interrupted, true, "interruption event is surfaced");

const malformed = parseChatStreamChunk(
  "",
  `not-json\n${eventLine({ type: "delta", delta: "ok" })}`
);
assert.equal(malformed.malformedLines.length, 1, "malformed NDJSON event is reported");
assert.equal(malformed.events.length, 1, "valid events after malformed lines are still parsed");

const flushed = flushChatStreamBuffer(JSON.stringify({ type: "done", payload: { text: "ok" } }));
assert.equal(flushed.events.length, 1, "tail buffer flush parses final event");

console.log("Streaming regression tests passed");
