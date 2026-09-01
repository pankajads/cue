import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { _electron as electron, Page } from "playwright-core";
import {
  HR_WARNING_RUDE_LATE_ENGINEER,
  SUPPORT_CALL_FRUSTRATED_CUSTOMER,
  ScenarioUtterance,
  utteranceToEvents,
} from "../fixtures/conversation-scenarios";

/**
 * The algorithm itself is validated exhaustively, turn by turn, in
 * tests/unit/conversation-scenarios.test.ts. This test's job is narrower and
 * different: prove the real UI — the actual popover window, the actual
 * click-free integration point renderer.ts exposes — surfaces the same
 * result a real speech-to-text pipeline feeding it these two transcripts
 * would produce. It reads the guidance panel's real DOM, not the session
 * object directly.
 */
async function replayInApp(page: Page, utterances: ScenarioUtterance[]): Promise<void> {
  await page.evaluate(() => window.sentimentAdvisorGuidance.reset());
  for (const utterance of utterances) {
    for (const event of utteranceToEvents(utterance)) {
      await page.evaluate((e) => window.sentimentAdvisorGuidance.ingestTranscriptEvent(e), event);
    }
  }
}

async function guidancePanelText(page: Page) {
  return {
    priorityClass: (await page.getAttribute("#guidance-panel", "class")) ?? "",
    headline: (await page.textContent("#guidance-headline")) ?? "",
    suggestion: (await page.textContent("#guidance-suggestion")) ?? "",
    source: (await page.textContent("#guidance-source")) ?? "",
  };
}

test("the guidance panel reaches urgent, escalating wording for a frustrated customer support call", async () => {
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
    await page.waitForFunction(() => typeof window.sentimentAdvisorGuidance !== "undefined");

    await replayInApp(page, SUPPORT_CALL_FRUSTRATED_CUSTOMER);
    let panel = await guidancePanelText(page);
    assert.equal(panel.source, "rules");
    assert.match(panel.priorityClass ?? "", /guidance-priority-caution/);
    assert.equal(panel.headline, "Negative sentiment");

    // Replay only the turns that reach the urgent peak, to check the panel
    // reflects that state too (not just the final resolved state above).
    await replayInApp(page, SUPPORT_CALL_FRUSTRATED_CUSTOMER.slice(0, 5));
    panel = await guidancePanelText(page);
    assert.match(panel.priorityClass ?? "", /guidance-priority-urgent/);
    assert.equal(panel.headline, "High tension, negative sentiment");
    assert.match(panel.suggestion, /Acknowledge the frustration/);
  } finally {
    await app.close();
  }
});

test("the guidance panel stays urgent through an HR warning about repeated rudeness and lateness", async () => {
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
    await page.waitForFunction(() => typeof window.sentimentAdvisorGuidance !== "undefined");

    await replayInApp(page, HR_WARNING_RUDE_LATE_ENGINEER);
    const panel = await guidancePanelText(page);
    assert.equal(panel.source, "rules");
    assert.match(panel.priorityClass ?? "", /guidance-priority-urgent/);
    assert.match(panel.headline, /Still high tension/);
  } finally {
    await app.close();
  }
});
