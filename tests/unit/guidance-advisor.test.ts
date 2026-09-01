import { test } from "node:test";
import assert from "node:assert/strict";
import { GuidanceAdvisor } from "../../src/shared/guidance/guidance-advisor";
import { EMPTY_SIGNAL_SNAPSHOT, SignalSnapshot } from "../../src/shared/guidance/types";

function snapshot(overrides: Partial<SignalSnapshot>): SignalSnapshot {
  return { ...EMPTY_SIGNAL_SNAPSHOT, turnCount: 1, lastChannel: "remote", ...overrides };
}

test("zero turns returns the empty guidance and resets any streak", () => {
  const advisor = new GuidanceAdvisor();
  advisor.advise(snapshot({ sentiment: "negative", tension: "high" }));
  const guidance = advisor.advise({ ...EMPTY_SIGNAL_SNAPSHOT, turnCount: 0 });
  assert.equal(guidance.headline, "Gathering context");
  assert.equal(guidance.turnsAtThisSeverity, 0);
});

test("negative + high tension escalates its wording as the streak grows", () => {
  const advisor = new GuidanceAdvisor();
  const situation = snapshot({ sentiment: "negative", tension: "high" });

  const first = advisor.advise(situation);
  assert.equal(first.priority, "urgent");
  assert.equal(first.turnsAtThisSeverity, 1);
  assert.match(first.suggestion, /Acknowledge the frustration/);

  const second = advisor.advise(situation);
  assert.equal(second.turnsAtThisSeverity, 2);
  assert.match(second.suggestion, /naming an apology again won't land twice/);
  assert.notEqual(second.suggestion, first.suggestion);

  const fourth = advisor.advise(situation);
  const fifth = advisor.advise(situation);
  assert.equal(fifth.turnsAtThisSeverity, 4);
  assert.match(fifth.suggestion, /Consider escalating for real/);
  assert.notEqual(fifth.suggestion, second.suggestion);
  void fourth;
});

test("switching to a different category resets the streak to 1", () => {
  const advisor = new GuidanceAdvisor();
  advisor.advise(snapshot({ sentiment: "negative", tension: "high" }));
  advisor.advise(snapshot({ sentiment: "negative", tension: "high" }));
  const guidance = advisor.advise(snapshot({ sentiment: "positive", tension: "low" }));
  assert.equal(guidance.headline, "Calm and positive");
  assert.equal(guidance.turnsAtThisSeverity, 1);
});

test("an unanswered question takes priority over sentiment/tension", () => {
  const advisor = new GuidanceAdvisor();
  const guidance = advisor.advise(
    snapshot({ sentiment: "negative", tension: "high", unansweredQuestion: true })
  );
  assert.equal(guidance.headline, "Question left hanging");
  assert.equal(guidance.priority, "caution");
});
