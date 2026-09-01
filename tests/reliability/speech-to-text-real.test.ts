import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { _electron as electron } from "playwright-core";

/**
 * The test that actually matters for a "highly reliable" claim: does the
 * real Whisper pipeline (no fakes, no stubs) transcribe real speech
 * correctly? Every other STT test in this repo deliberately fakes the
 * transcription engine (tests/e2e/speech-to-text-wiring.test.ts) — that
 * proves the plumbing around it is correct, never that transcription
 * itself works. This is the one test that can catch "the model loads but
 * produces garbage" or "the audio format is subtly wrong and Whisper hears
 * silence."
 *
 * Deliberately NOT part of `npm test` / CI (see package.json's separate
 * "test:reliability" script and ARCHITECTURE.md): it downloads the real
 * ~150MB model on first run, needs macOS's `say`/`afconvert` to synthesize
 * a speech sample, and is slower and network-dependent — the kind of test
 * that belongs in a deliberate, occasional run, not on every PR.
 */
test(
  "the real Whisper pipeline transcribes real synthesized speech correctly",
  { timeout: 180_000 },
  async () => {
    const spokenText = "This is completely unacceptable, I have had this problem for two weeks";
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "sentiment-advisor-stt-reliability-"));
    const aiffPath = path.join(workDir, "sample.aiff");
    const wavPath = path.join(workDir, "sample.wav");

    execFileSync("say", ["-o", aiffPath, spokenText]);
    execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", "-c", "1", aiffPath, wavPath]);

    const pcm = parseWavPcm16Mono(fs.readFileSync(wavPath));
    assert.ok(pcm.length > 0, "expected the synthesized WAV to contain audio samples");

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

      const transcribed = await page.evaluate(
        (pcmArray) => window.sentimentAdvisorTestHooks.transcribeForTesting(pcmArray),
        Array.from(pcm)
      );

      const normalized = transcribed.toLowerCase();
      assert.ok(
        normalized.includes("unacceptable") && normalized.includes("problem"),
        `real Whisper transcription didn't recognize the expected words.\nSpoken: "${spokenText}"\nTranscribed: "${transcribed}"`
      );
    } finally {
      await app.close();
    }
  }
);

/** Minimal RIFF/WAVE parser for 16-bit PCM audio — scans chunks rather than
 * assuming a fixed 44-byte header, since afconvert's output isn't
 * guaranteed to match that exactly. */
function parseWavPcm16Mono(buffer: Buffer): Float32Array {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }

  let offset = 12;
  let dataOffset = -1;
  let dataLength = 0;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    if (chunkId === "data") {
      dataOffset = offset + 8;
      dataLength = chunkSize;
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2); // chunks are padded to an even size
  }
  if (dataOffset === -1) {
    throw new Error("no data chunk found in WAV file");
  }

  const sampleCount = Math.floor(dataLength / 2);
  const samples = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = buffer.readInt16LE(dataOffset + i * 2) / 32768;
  }
  return samples;
}
