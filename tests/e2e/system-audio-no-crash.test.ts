import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { _electron as electron } from "playwright-core";

/**
 * Regression test for a real bug: clicking "Start listening" used to crash
 * the entire renderer process. The legacy
 * getUserMedia({ audio: { mandatory: { chromeMediaSource: 'desktop', ... } } })
 * pattern for system/"remote" audio is audio-only desktop capture, which
 * Chromium does not support gracefully — it kills the renderer with
 * "Terminating renderer for bad IPC message, reason 263
 * (DESKTOP_CAPTURER_INVALID_OR_UNKNOWN_ID)", turning the popover into a
 * blank white window. See main.ts and renderer.ts for the fix:
 * getDisplayMedia + session.setDisplayMediaRequestHandler.
 *
 * Unlike start-listening.test.ts, this test does NOT stub getUserMedia or
 * getDisplayMedia — it exercises the real, unmodified code path end to end,
 * including main.ts's setDisplayMediaRequestHandler. It deliberately does
 * NOT assert that the system-audio level meter moves: this test runner has
 * no real ambient system audio playing, and (see ARCHITECTURE.md) Electron's
 * own shipped types currently document loopback audio here as Windows-only,
 * so on other platforms a track may simply carry silence. What must always
 * be true regardless of platform or ambient sound is that the renderer
 * survives the click and reaches one of the two known, non-crashed terminal
 * states.
 */
test("clicking Start listening never crashes the renderer, even without any audio stubbing", async () => {
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

    let crashed = false;
    page.on("crash", () => {
      crashed = true;
    });

    await page.click("#start-button");

    // Give both getUserMedia and getDisplayMedia (real hardware/OS
    // permission calls) a real window to resolve or reject in.
    await page.waitForFunction(
      () => document.getElementById("system-status")?.textContent !== "not started",
      undefined,
      { timeout: 10_000 }
    );

    assert.equal(crashed, false, "the renderer process crashed");

    const systemStatus = await page.textContent("#system-status");

    // A message like "Cannot read properties of undefined" or a raw stack
    // trace would mean something in the wiring broke; a clean "listening"
    // or a clean "unavailable (...)" degrade are the only two acceptable
    // outcomes. (The mic row is out of scope here — real, unstubbed mic
    // permission prompts in a non-interactive environment are a separate,
    // already-documented limitation, not what this test regresses against.)
    assert.ok(
      systemStatus === "listening" || /^unavailable /.test(systemStatus ?? ""),
      `unexpected system-audio status after a real (unstubbed) attempt: ${systemStatus}`
    );
  } finally {
    await app.close();
  }
});
