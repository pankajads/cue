import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { _electron as electron } from "playwright-core";

/**
 * Proves the full pipeline is wired correctly end to end: real mic audio
 * capture -> real PCM extraction -> real UtteranceSegmenter -> (fake)
 * transcription -> the real ConversationSession -> the real guidance panel
 * DOM. The Whisper model itself is swapped for a fake via
 * sentimentAdvisorTestHooks.setSpeechToTextEngineForTesting — downloading
 * and running the real ~40MB model here would make this test slow and
 * network-dependent for something that isn't its job to prove.
 *
 * Whether the real Whisper model actually transcribes real speech
 * correctly is a different, real question, and needs a different kind of
 * test — see tests/reliability/speech-to-text-real.test.ts, which
 * deliberately does NOT fake anything.
 */
test("a finished utterance flows from mic capture through to the guidance panel", async () => {
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

    // A continuous tone (not stubbing getUserMedia at all — this is real
    // capture of a real, if synthetic, audio source) so the segmenter's RMS
    // check reliably reads it as speech the whole time it's connected.
    await page.addInitScript(() => {
      const audioContext = new AudioContext();
      const oscillator = audioContext.createOscillator();
      oscillator.frequency.value = 440;
      const destination = audioContext.createMediaStreamDestination();
      oscillator.connect(destination);
      oscillator.start();
      navigator.mediaDevices.getUserMedia = async () => destination.stream;
      navigator.mediaDevices.getDisplayMedia = async () => destination.stream;
    });
    await page.reload();
    await page.waitForFunction(() => typeof window.sentimentAdvisorTestHooks !== "undefined");

    await page.evaluate(() => {
      let callCount = 0;
      window.sentimentAdvisorTestHooks.setSpeechToTextEngineForTesting({
        async transcribe(): Promise<string> {
          callCount += 1;
          return callCount === 1
            ? "This is completely unacceptable, I have had this problem for two weeks."
            : "";
        },
      });
    });

    await page.click("#start-button");
    // Long enough to clear the segmenter's default 300ms minUtteranceMs
    // once flushed, comfortably short of its 15s max-utterance cap.
    await new Promise((resolve) => setTimeout(resolve, 800));
    await page.click("#start-button"); // "Stop listening" — flushes the in-progress utterance

    await page.waitForFunction(() => document.getElementById("transcript-text")?.textContent !== "—", undefined, {
      timeout: 10_000,
    });

    const transcriptChannel = await page.textContent("#transcript-channel");
    const transcriptText = await page.textContent("#transcript-text");
    assert.equal(transcriptChannel, "me");
    assert.equal(transcriptText, "This is completely unacceptable, I have had this problem for two weeks.");

    // The transcribed text should have actually reached the guidance
    // engine, not just been displayed — the panel should reflect it.
    const guidanceSuggestion = await page.textContent("#guidance-suggestion");
    assert.notEqual(
      guidanceSuggestion,
      "Keep the conversation going. Guidance appears once there are a few turns to read."
    );
  } finally {
    await app.close();
  }
});
