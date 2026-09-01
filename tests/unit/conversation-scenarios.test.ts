import { test } from "node:test";
import assert from "node:assert/strict";
import { ConversationSession } from "../../src/shared/guidance/conversation-session";
import { ConversationGuidance } from "../../src/shared/guidance/types";
import {
  HR_WARNING_RUDE_LATE_ENGINEER,
  SUPPORT_CALL_FRUSTRATED_CUSTOMER,
  ScenarioUtterance,
  utteranceToEvents,
} from "../fixtures/conversation-scenarios";

function replay(utterances: ScenarioUtterance[]): ConversationGuidance[] {
  const session = new ConversationSession();
  const guidancePerTurn: ConversationGuidance[] = [];
  for (const utterance of utterances) {
    for (const event of utteranceToEvents(utterance)) {
      session.consume(event);
    }
    guidancePerTurn.push(session.guidance);
  }
  return guidancePerTurn;
}

/**
 * Real-conversation validation, not synthetic snapshots: two full transcript
 * fixtures (tests/fixtures/conversation-scenarios.ts) representative of the
 * app's target use case, replayed through the actual analyzer + advisor +
 * session, asserting on the trajectory a person reading the guidance panel
 * would actually see turn by turn.
 */
test("support call: escalates to urgent guidance as the customer's frustration builds, and the wording changes each turn it persists", () => {
  const guidance = replay(SUPPORT_CALL_FRUSTRATED_CUSTOMER);

  // Early turns: nothing alarming yet.
  assert.equal(guidance[0].priority, "info");

  // "unacceptable"/"failure" turns push it to negative + urgent.
  const firstUrgent = guidance.findIndex((g) => g.priority === "urgent");
  assert.ok(firstUrgent >= 0, "expected the conversation to reach urgent priority");
  assert.equal(guidance[firstUrgent].headline, "High tension, negative sentiment");
  assert.equal(guidance[firstUrgent].turnsAtThisSeverity, 1);

  // It stays urgent for consecutive turns, and the streak — and therefore
  // the wording — visibly escalates rather than repeating.
  const second = guidance[firstUrgent + 1];
  assert.equal(second.priority, "urgent");
  assert.equal(second.turnsAtThisSeverity, 2);
  assert.notEqual(second.suggestion, guidance[firstUrgent].suggestion);

  // By the end, the concrete commitment from the agent brings it down from
  // urgent back to a caution-level "negative sentiment" read — the model
  // registers the de-escalation, even though the rolling window still
  // remembers the earlier negativity.
  const last = guidance[guidance.length - 1];
  assert.equal(last.priority, "caution");
  assert.equal(last.headline, "Negative sentiment");
});

test("HR warning: reaches and holds urgent guidance as the rudeness-and-lateness pattern is confirmed to repeat", () => {
  const guidance = replay(HR_WARNING_RUDE_LATE_ENGINEER);

  // Opens neutral — HR hasn't raised the issue yet.
  assert.equal(guidance[0].priority, "info");

  const firstUrgent = guidance.findIndex((g) => g.priority === "urgent");
  assert.ok(firstUrgent >= 0, "expected the conversation to reach urgent priority");
  assert.equal(guidance[firstUrgent].headline, "High tension, negative sentiment");

  // Unlike a de-escalating support call, a real disciplinary conversation
  // about a repeated pattern should stay urgent, with the streak — and the
  // headline text reporting it — climbing turn over turn through to the end.
  const tail = guidance.slice(firstUrgent);
  for (const g of tail) {
    assert.equal(g.priority, "urgent");
  }
  const streaks = tail.map((g) => g.turnsAtThisSeverity);
  for (let i = 1; i < streaks.length; i++) {
    assert.equal(streaks[i], streaks[i - 1] + 1, "expected the streak to climb every consecutive turn");
  }
  assert.match(guidance[guidance.length - 1].headline, /Still high tension/);
});
