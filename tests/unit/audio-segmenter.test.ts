import { test } from "node:test";
import assert from "node:assert/strict";
import { UtteranceSegmenter } from "../../src/renderer/audio-segmenter";

function silence(length = 160): Float32Array {
  return new Float32Array(length);
}

function tone(length = 160, amplitude = 0.5): Float32Array {
  const chunk = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    chunk[i] = amplitude * Math.sin(i);
  }
  return chunk;
}

test("silence alone never produces a segment", () => {
  const segmenter = new UtteranceSegmenter();
  let t = 0;
  for (let i = 0; i < 20; i++) {
    const result = segmenter.pushChunk(silence(), t);
    assert.equal(result, null);
    t += 10;
  }
  assert.equal(segmenter.flush(t), null);
});

test("speech followed by enough silence produces one segment", () => {
  const segmenter = new UtteranceSegmenter({ minSilenceMs: 500, minUtteranceMs: 100 });
  let t = 0;

  // ~400ms of speech in 20ms steps — no segment yet, still talking.
  for (let i = 0; i < 20; i++) {
    assert.equal(segmenter.pushChunk(tone(), t), null);
    t += 20;
  }

  // Silence starts (this push is what starts the silence timer, at
  // duration 0 — it can't itself cross the threshold).
  assert.equal(segmenter.pushChunk(silence(), t), null);

  // Not long enough yet to close the utterance (480ms < 500ms).
  for (let i = 0; i < 23; i++) {
    t += 20;
    assert.equal(segmenter.pushChunk(silence(), t), null);
  }

  // Comfortably past the 500ms silence threshold now.
  t += 200;
  const result = segmenter.pushChunk(silence(), t);
  assert.ok(result, "expected a finished segment once silence persisted long enough");
  assert.equal(result!.startedAtMs, 0);
  assert.ok(result!.endedAtMs > result!.startedAtMs);
  // The segment includes the speech and the trailing silence (a natural
  // pause is part of the utterance, not discarded).
  assert.ok(result!.pcm.length > 0);
});

test("a very short blip is dropped as noise, not treated as an utterance", () => {
  const segmenter = new UtteranceSegmenter({ minSilenceMs: 50, minUtteranceMs: 200 });
  let t = 0;
  // One 20ms chunk of "speech" followed by enough silence to close the
  // utterance — but the whole thing is well under minUtteranceMs (200ms),
  // so it should be dropped as noise rather than reported as a segment.
  segmenter.pushChunk(tone(), t);
  t += 20;
  segmenter.pushChunk(silence(), t); // starts the silence timer
  t += 60; // past the 50ms silence threshold
  const result = segmenter.pushChunk(silence(), t);
  assert.equal(result, null);
});

test("a single monologue longer than maxUtteranceMs is force-cut", () => {
  const segmenter = new UtteranceSegmenter({ maxUtteranceMs: 1000, minUtteranceMs: 100 });
  let t = 0;
  let result = null;
  // Continuous speech, no silence at all, well past the 1000ms cap.
  for (let i = 0; i < 60 && !result; i++) {
    result = segmenter.pushChunk(tone(), t);
    t += 20;
  }
  assert.ok(result, "expected the segmenter to force-cut a too-long monologue");
  assert.ok(result!.endedAtMs - result!.startedAtMs >= 1000);
});

test("after finishing a segment, the segmenter is ready to start a fresh one", () => {
  const segmenter = new UtteranceSegmenter({ minSilenceMs: 100, minUtteranceMs: 50 });
  let t = 0;

  segmenter.pushChunk(tone(), t);
  t += 20;
  segmenter.pushChunk(silence(), t); // starts the silence timer
  t += 150;
  const first = segmenter.pushChunk(silence(), t); // past the 100ms threshold
  assert.ok(first);

  // A brand new utterance after the first one closed.
  t += 500;
  segmenter.pushChunk(tone(), t);
  t += 20;
  segmenter.pushChunk(silence(), t);
  t += 150;
  const second = segmenter.pushChunk(silence(), t);
  assert.ok(second);
  assert.ok(second!.startedAtMs > first!.endedAtMs);
});

test("flush with nothing buffered returns null", () => {
  const segmenter = new UtteranceSegmenter();
  assert.equal(segmenter.flush(1000), null);
});

test("flush force-finalizes an in-progress utterance (e.g. on Stop listening)", () => {
  const segmenter = new UtteranceSegmenter({ minUtteranceMs: 50 });
  let t = 0;
  segmenter.pushChunk(tone(), t);
  t += 100;
  segmenter.pushChunk(tone(), t);
  t += 100;
  const result = segmenter.flush(t);
  assert.ok(result, "expected flush to return the in-progress utterance");
  assert.equal(result!.startedAtMs, 0);
});

test("pure silence below the RMS threshold is never mistaken for speech", () => {
  const segmenter = new UtteranceSegmenter({ silenceRmsThreshold: 0.05 });
  // Amplitude 0.01 is quieter than the 0.05 threshold.
  const quiet = tone(160, 0.01);
  const result = segmenter.pushChunk(quiet, 0);
  assert.equal(result, null);
  assert.equal(segmenter.flush(1000), null);
});
