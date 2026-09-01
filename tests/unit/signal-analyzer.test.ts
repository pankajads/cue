import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeSignals } from "../../src/shared/guidance/signal-analyzer";
import { ConversationTurn } from "../../src/shared/guidance/types";

function turn(text: string, channel: ConversationTurn["channel"], startedAtMs: number, endedAtMs: number): ConversationTurn {
  return { text, channel, startedAtMs, endedAtMs };
}

test("empty transcript returns the empty/unknown snapshot", () => {
  const snapshot = analyzeSignals([]);
  assert.equal(snapshot.sentiment, "unknown");
  assert.equal(snapshot.tension, "unknown");
  assert.equal(snapshot.turnCount, 0);
});

test("aggregate negative sentiment crosses the negative threshold", () => {
  const snapshot = analyzeSignals([
    turn("This has been a total failure and it is unacceptable.", "remote", 0, 3000),
  ]);
  assert.equal(snapshot.sentiment, "negative");
});

test("lexicon-positive turns push sentiment positive", () => {
  const snapshot = analyzeSignals([
    turn("Thanks, that's great, I agree this is good progress.", "remote", 0, 3000),
  ]);
  assert.equal(snapshot.sentiment, "positive");
});

test("a question left by the same channel across two turns is flagged unanswered", () => {
  const snapshot = analyzeSignals([
    turn("Hello there", "remote", 0, 1000),
    turn("What is going on here?", "remote", 1200, 2500),
  ]);
  assert.equal(snapshot.unansweredQuestion, true);
});

test("a question answered by the other channel is not flagged unanswered", () => {
  const snapshot = analyzeSignals([
    turn("What is going on here?", "remote", 0, 1500),
    turn("Let me check on that for you.", "me", 1700, 3000),
  ]);
  assert.equal(snapshot.unansweredQuestion, false);
});

test("only the most recent 8 turns are considered", () => {
  const turns: ConversationTurn[] = [];
  for (let i = 0; i < 10; i++) {
    // First two turns are strongly negative; if they were still in the
    // window they would pull the aggregate score negative.
    const text = i < 2 ? "This is a failure, totally unacceptable and wrong." : "Thanks, great, good progress.";
    turns.push(turn(text, i % 2 === 0 ? "remote" : "me", i * 2000, i * 2000 + 1200));
  }
  const snapshot = analyzeSignals(turns);
  assert.equal(snapshot.turnCount, 10);
  assert.equal(snapshot.sentiment, "positive");
});
