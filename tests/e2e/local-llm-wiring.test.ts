import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { _electron as electron } from "playwright-core";

/**
 * Proves the racing/upgrade wiring end to end through the real UI: a fake
 * LlmGuidanceEngine (attached via sentimentAdvisorTestHooks, the same
 * pattern as the STT wiring test) stands in for the real ~490MB model, so
 * this stays fast and deterministic. It proves ConversationSession really
 * calls the attached engine and the guidance panel really re-renders with
 * the upgraded result, tagged "llm" — not that the real model produces good
 * output, which is a different question answered by
 * tests/reliability/local-llm-real.test.ts.
 */
test("an attached local-LLM engine upgrades the guidance panel, tagged llm", async () => {
  const electronBinary = require("electron") as unknown as string;
  const appEntry = path.join(__dirname, "..", "..", "..", "dist", "main", "main.js");

  const env: Record<string, string> = { SENTIMENT_ADVISOR_E2E_TEST_HOOKS: "1" };
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "ELECTRON_RUN_AS_NODE") {
      env[key] = value;
    }
  }

  const app = await electron.launch({ executablePath: electronBinary, args: [appEntry], env });
  try {
    const [page] = await Promise.all([
      app.firstWindow(),
      app.evaluate(() => {
        (
          global as unknown as { __sentimentAdvisorTestHooks: { togglePopover: () => void } }
        ).__sentimentAdvisorTestHooks.togglePopover();
      }),
    ]);
    await page.waitForFunction(() => typeof window.sentimentAdvisorTestHooks !== "undefined");

    await page.evaluate(() => {
      window.sentimentAdvisorTestHooks.setLlmGuidanceEngineForTesting({
        async advise() {
          return {
            sentiment: "negative",
            tension: "high",
            guidance: "This is the local-LLM-generated suggestion.",
          };
        },
      });
    });

    // Before the LLM engine was attached, this exact transcript already had
    // rule-based coverage (tests/unit/conversation-scenarios.test.ts) — the
    // point here is only what happens *in addition* once an engine answers.
    await page.evaluate(() => {
      window.sentimentAdvisorGuidance.ingestTranscriptEvent({
        text: "This is completely unacceptable, I've had this problem for two weeks.",
        channel: "remote",
        isFinal: true,
        timestampMs: Date.now(),
      });
    });

    await page.waitForFunction(() => document.getElementById("guidance-source")?.textContent === "llm", undefined, {
      timeout: 5_000,
    });

    const headline = await page.textContent("#guidance-headline");
    const suggestion = await page.textContent("#guidance-suggestion");
    const priorityClass = await page.getAttribute("#guidance-panel", "class");

    assert.equal(suggestion, "This is the local-LLM-generated suggestion.");
    assert.match(headline ?? "", /Negative.*High tension/i);
    assert.match(priorityClass ?? "", /guidance-priority-urgent/);
  } finally {
    await app.close();
  }
});
