import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { _electron as electron } from "playwright-core";

/**
 * Drives the real app end-to-end the way a human tester was going to: click
 * the popover's "Start listening" button and watch the level meters. This
 * runs over Chromium's DevTools Protocol (the same channel Electron uses
 * internally), not macOS's Accessibility APIs, so it needs no Accessibility
 * permission grant and works in a sandboxed shell that can't click real UI.
 *
 * It cannot exercise real microphone/system-audio hardware — that's gated
 * behind a one-time OS permission dialog only a human in an interactive
 * session can approve, which is a hard limit of this environment, not of
 * the test approach. What it *can* prove, for real, without any mocking of
 * the app's own code: that clicking the button wires up a MediaStream to a
 * live AnalyserNode and the level meter actually reflects real audio data
 * flowing through it. `navigator.mediaDevices.getUserMedia` is replaced
 * with a fake that returns a real Web Audio oscillator's output instead of
 * a real mic/desktop capture — everything downstream of that call
 * (renderer.ts's driveLevelMeter, the RMS-to-width math, the status text)
 * is the app's real, unmodified code.
 */
test("clicking Start listening drives the microphone level meter from real audio data", async () => {
  const electronBinary = require("electron") as unknown as string;
  const appEntry = path.join(__dirname, "..", "..", "dist", "main", "main.js");

  const env: Record<string, string> = { SENTIMENT_ADVISOR_E2E_TEST_HOOKS: "1" };
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "ELECTRON_RUN_AS_NODE") {
      env[key] = value;
    }
  }

  const app = await electron.launch({
    executablePath: electronBinary,
    args: [appEntry],
    env,
  });

  try {
    // No BrowserWindow exists until the tray is clicked, and there is no
    // cross-platform way to simulate a native tray click over CDP — so ask
    // the app's own test hook (main.ts) to open the popover the same way a
    // real click would, then wait for the window it creates.
    const [window] = await Promise.all([
      app.firstWindow(),
      app.evaluate(() => {
        (
          global as unknown as { __sentimentAdvisorTestHooks: { togglePopover: () => void } }
        ).__sentimentAdvisorTestHooks.togglePopover();
      }),
    ]);

    // Installed before reload so it's in place the moment renderer.ts's
    // top-level code runs and attaches the button's click handler.
    await window.addInitScript(() => {
      const audioContext = new AudioContext();
      const oscillator = audioContext.createOscillator();
      oscillator.frequency.value = 440;
      const destination = audioContext.createMediaStreamDestination();
      oscillator.connect(destination);
      oscillator.start();

      navigator.mediaDevices.getUserMedia = async () => destination.stream;
    });
    await window.reload();

    await window.click("#start-button");

    await window.waitForFunction(
      () => {
        const el = document.getElementById("mic-level") as HTMLElement | null;
        return !!el && parseFloat(el.style.width) > 0;
      },
      undefined,
      { timeout: 5_000 }
    );

    const micStatus = await window.textContent("#mic-status");
    const micWidth = await window.$eval("#mic-level", (el) => parseFloat((el as HTMLElement).style.width));
    assert.equal(micStatus, "listening");
    assert.ok(micWidth > 0, `expected mic level meter to move, got width ${micWidth}%`);

    // System audio additionally depends on this machine's screen-recording
    // TCC grant for the Electron binary, which this test doesn't control —
    // both outcomes are legitimate depending on host state, so assert the
    // meter only moves in the branch where a source was actually returned.
    // It also resolves via its own IPC round-trip, on its own schedule
    // independent of the mic wait above, so it needs its own wait.
    await window.waitForFunction(
      () => document.getElementById("system-status")?.textContent !== "not started",
      undefined,
      { timeout: 5_000 }
    );
    const systemStatus = await window.textContent("#system-status");
    assert.ok(
      systemStatus === "listening" || systemStatus === "unavailable (permission or platform)",
      `unexpected system-audio status: ${systemStatus}`
    );
    if (systemStatus === "listening") {
      // Reaching "listening" only means the stream was attached; the meter
      // itself updates on its own requestAnimationFrame loop a tick later.
      await window.waitForFunction(
        () => {
          const el = document.getElementById("system-level") as HTMLElement | null;
          return !!el && parseFloat(el.style.width) > 0;
        },
        undefined,
        { timeout: 5_000 }
      );
      const systemWidth = await window.$eval("#system-level", (el) => parseFloat((el as HTMLElement).style.width));
      assert.ok(systemWidth > 0, `expected system level meter to move, got width ${systemWidth}%`);
    }
  } finally {
    await app.close();
  }
});
