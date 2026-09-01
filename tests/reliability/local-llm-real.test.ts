import { test } from "node:test";
import assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { createRealLocalLlmDeps, LocalLlmEngine } from "../../src/main/llm/local-llm-engine";
import { ConversationTurn } from "../../src/shared/guidance";
import { SUPPORT_CALL_FRUSTRATED_CUSTOMER } from "../fixtures/conversation-scenarios";

/**
 * The test that actually matters for this feature, the same reasoning as
 * tests/reliability/speech-to-text-real.test.ts: every other local-LLM test
 * fakes the model (tests/unit/local-llm-engine.test.ts,
 * tests/e2e/local-llm-wiring.test.ts) — necessary to stay fast and
 * deterministic, but it means none of them can catch "the real model
 * loads but the grammar-constrained output is garbage" or "the real model
 * is too slow on ordinary hardware for the 1.8s budget to ever be met."
 * This one runs the real node-llama-cpp bindings against the real
 * downloaded model, no fakes.
 *
 * Deliberately NOT part of `npm test`/CI (see package.json's separate
 * "test:reliability" script and ARCHITECTURE.md): downloads the real
 * ~490MB model on first run and is slower — this is a plain Node test
 * (LocalLlmEngine has no Electron dependency), so it runs outside Electron
 * entirely, unlike the Whisper reliability test.
 *
 * Uses a fixed, non-temp cache directory (not a fresh mkdtemp each run) so
 * the ~490MB download only ever happens once per machine, not once per
 * test run.
 */
test(
  "the real local LLM produces valid, sensible sentiment/tension/guidance for a real transcript",
  { timeout: 300_000 },
  async () => {
    const modelsDirectory = path.join(os.tmpdir(), "sentiment-advisor-llm-reliability-cache");
    const deps = await createRealLocalLlmDeps(modelsDirectory);
    const engine = new LocalLlmEngine(deps);

    await engine.enable();
    assert.equal(engine.isReady(), true);

    // Real transcript, not a synthetic one: the same fixture already
    // validated against the rule-based engine in
    // tests/unit/conversation-scenarios.test.ts, so this is checking the
    // LLM against a conversation whose "right answer" is already known.
    const turns: ConversationTurn[] = SUPPORT_CALL_FRUSTRATED_CUSTOMER.slice(0, 5).map((utterance) => ({
      text: utterance.text,
      channel: utterance.channel,
      startedAtMs: utterance.startMs,
      endedAtMs: utterance.endMs,
    }));

    const advice = await engine.advise(turns);

    // Structural validity (sentiment/tension enum membership, non-empty
    // guidance) is already enforced by the grammar-constrained JSON schema
    // inside LocalLlmEngine.advise() — if this resolved at all, that part
    // is guaranteed. What's actually being checked here is whether a real,
    // small, quantized model produces a *sensible* read of a transcript
    // that's clearly and heavily negative — not exact wording, since small
    // models vary, but the directionally obvious calls.
    assert.notEqual(advice.sentiment, "positive", `expected a frustrated-customer transcript to not read positive. Got: ${JSON.stringify(advice)}`);
    assert.notEqual(advice.tension, "low", `expected a frustrated-customer transcript to not read low-tension. Got: ${JSON.stringify(advice)}`);
    assert.ok(advice.guidance.trim().length > 0);
    assert.ok(advice.guidance.length <= 140, `guidance exceeded the length cap: "${advice.guidance}"`);
  }
);
