// Pure logic, no Web Audio/DOM dependency — takes plain PCM chunks in and
// hands finished utterances back out, so it's unit-testable with synthetic
// Float32Arrays and has nothing to do with how the audio actually arrives.

export interface SegmenterOptions {
  /** RMS below this is treated as silence. Default 0.01. */
  silenceRmsThreshold?: number;
  /** How long silence must persist before an utterance is considered finished. Default 600ms. */
  minSilenceMs?: number;
  /** Utterances shorter than this are dropped as noise/clicks, not real speech. Default 300ms. */
  minUtteranceMs?: number;
  /** Hard cap so one long monologue doesn't grow forever before Whisper ever runs on it. Default 15000ms. */
  maxUtteranceMs?: number;
}

type ResolvedOptions = Required<SegmenterOptions>;

export interface SegmentResult {
  pcm: Float32Array;
  startedAtMs: number;
  endedAtMs: number;
}

function computeRms(chunk: Float32Array): number {
  let sumSquares = 0;
  for (const sample of chunk) {
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / chunk.length);
}

function concatFloat32(chunks: Float32Array[]): Float32Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Simple energy-based voice-activity segmenter. Whisper is not a streaming
 * model — it needs a complete utterance's audio at once — so this turns a
 * continuous stream of PCM chunks into the discrete finished utterances
 * that both Whisper and the guidance engine's per-turn model actually
 * operate on: accumulates chunks while RMS stays above a threshold, and
 * emits the utterance once silence has persisted long enough to call it
 * over.
 *
 * Timestamps are supplied by the caller (real wall-clock time, e.g.
 * `Date.now()`) rather than accumulated internally from chunk sample
 * counts. This matters beyond precision: mic and system audio each get
 * their own independent segmenter instance, and the guidance engine's
 * pause/interruption detection compares timestamps *across* those two
 * instances — they only line up correctly if both are stamped from the
 * same shared clock.
 */
export class UtteranceSegmenter {
  private readonly options: ResolvedOptions;
  private buffer: Float32Array[] = [];
  private voiceActive = false;
  private silenceStartMs: number | null = null;
  private utteranceStartMs: number | null = null;

  constructor(options: SegmenterOptions = {}) {
    this.options = {
      silenceRmsThreshold: 0.01,
      minSilenceMs: 600,
      minUtteranceMs: 300,
      maxUtteranceMs: 15_000,
      ...options,
    };
  }

  /**
   * Feed one chunk of mono PCM samples, timestamped at (approximately) the
   * moment it was captured. Returns a finished segment if this chunk
   * completed one, otherwise null.
   */
  pushChunk(chunk: Float32Array, nowMs: number): SegmentResult | null {
    const isSpeech = computeRms(chunk) >= this.options.silenceRmsThreshold;
    let result: SegmentResult | null = null;

    if (isSpeech) {
      if (!this.voiceActive) {
        this.voiceActive = true;
        this.utteranceStartMs = nowMs;
        this.buffer = [];
      }
      this.silenceStartMs = null;
      this.buffer.push(chunk);
    } else if (this.voiceActive) {
      // Trailing silence stays part of the segment (a natural short pause,
      // not noise) until it's persisted long enough to call the utterance
      // over.
      this.buffer.push(chunk);
      if (this.silenceStartMs === null) {
        this.silenceStartMs = nowMs;
      }
      if (nowMs - this.silenceStartMs >= this.options.minSilenceMs) {
        result = this.finish(nowMs);
      }
    }

    if (result === null && this.voiceActive && this.utteranceStartMs !== null) {
      if (nowMs - this.utteranceStartMs >= this.options.maxUtteranceMs) {
        result = this.finish(nowMs);
      }
    }

    return result;
  }

  /** Force-finalizes whatever is currently buffered — call on "Stop listening"
   * so a trailing utterance isn't silently dropped. */
  flush(nowMs: number): SegmentResult | null {
    if (!this.voiceActive) return null;
    return this.finish(nowMs);
  }

  private finish(nowMs: number): SegmentResult | null {
    const startedAtMs = this.utteranceStartMs ?? nowMs;
    const endedAtMs = nowMs;
    const pcm = concatFloat32(this.buffer);

    this.buffer = [];
    this.voiceActive = false;
    this.silenceStartMs = null;
    this.utteranceStartMs = null;

    if (endedAtMs - startedAtMs < this.options.minUtteranceMs || pcm.length === 0) {
      return null;
    }
    return { pcm, startedAtMs, endedAtMs };
  }
}
