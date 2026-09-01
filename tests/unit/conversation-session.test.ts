import { test } from "node:test";
import assert from "node:assert/strict";
import { ConversationSession } from "../../src/shared/guidance/conversation-session";
import { LlmAdvice, LlmGuidanceEngine } from "../../src/shared/guidance/conversation-session";
import { TranscriptEvent } from "../../src/shared/guidance/types";

function finalEvent(text: string, channel: TranscriptEvent["channel"], timestampMs: number): TranscriptEvent {
  return { text, channel, isFinal: true, timestampMs };
}

test("interim events do not create a turn or change guidance", () => {
  const session = new ConversationSession();
  const before = session.guidance;
  session.consume({ text: "partial...", channel: "remote", isFinal: false, timestampMs: 0 });
  assert.equal(session.signals.turnCount, 0);
  assert.deepEqual(session.guidance, before);
});

test("a final event produces a turn and computes signals + rule-based guidance synchronously", () => {
  const session = new ConversationSession();
  session.consume({ text: "hello there", channel: "remote", isFinal: false, timestampMs: 0 });
  const guidance = session.consume(finalEvent("hello there, this is unacceptable and a failure", "remote", 2000));
  assert.equal(session.signals.turnCount, 1);
  assert.equal(guidance.source, "rules");
});

test("reset clears turns, signals, and the guidance streak", () => {
  const session = new ConversationSession();
  session.consume(finalEvent("this is a failure and totally unacceptable", "remote", 0));
  session.reset();
  assert.equal(session.signals.turnCount, 0);
  assert.equal(session.guidance.headline, "Gathering context");
});

test("an attached LLM engine upgrades guidance asynchronously, tagged as such", async () => {
  const session = new ConversationSession();
  const advice: LlmAdvice = { sentiment: "negative", tension: "high", guidance: "Slow down and acknowledge it." };
  const engine: LlmGuidanceEngine = { advise: async () => advice };
  session.attachLlmEngine(engine);

  let updated: string | null = null;
  session.consume(finalEvent("this is a failure and totally unacceptable", "remote", 0), (g) => {
    updated = g.suggestion;
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(updated, advice.guidance);
  assert.equal(session.guidance.source, "llm");
});

test("a stale LLM response for an old turn is dropped once a newer turn has landed", async () => {
  const session = new ConversationSession();
  let resolveFirst: (advice: LlmAdvice) => void = () => {};
  const firstPromise = new Promise<LlmAdvice>((resolve) => (resolveFirst = resolve));
  let callCount = 0;
  const engine: LlmGuidanceEngine = {
    advise: async () => {
      callCount += 1;
      return callCount === 1 ? firstPromise : { sentiment: "neutral", tension: "stable", guidance: "second" };
    },
  };
  session.attachLlmEngine(engine);

  session.consume(finalEvent("first turn, a real failure", "remote", 0));
  session.consume(finalEvent("second turn, another failure", "remote", 1000));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(session.guidance.source, "llm");
  assert.equal(session.guidance.suggestion, "second");

  // The slow first-turn response arrives after the second turn already
  // landed and was applied above — it must not overwrite it.
  resolveFirst({ sentiment: "negative", tension: "high", guidance: "stale" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(session.guidance.suggestion, "second");
});
