// Runs Whisper entirely in-renderer via @huggingface/transformers (the
// official, actively maintained successor to transformers.js), over
// onnxruntime-web's WASM backend — not a native whisper.cpp addon. That
// choice trades a little raw speed for a much larger reliability win: no
// per-platform prebuilt-binary matrix, no native compilation, nothing that
// can fail the way LocalLLMClient's C++ interop did in the sibling Swift
// project. The renderer is a real Chromium context, which is exactly the
// environment this library is built for. See ARCHITECTURE.md.

export interface SpeechToTextEngine {
  transcribe(pcm: Float32Array): Promise<string>;
}

/** Smallest English-only Whisper model — chosen for low latency ("quick
 * sentiment analysis") over max accuracy; swapping to Xenova/whisper-base.en
 * later needs no architecture change.
 *
 * Loaded at fp32 (~150MB), not a smaller quantized dtype: this repo's
 * quantized decoder export (q8 and q4 both) is broken — confirmed by
 * actually loading it, not assumed — failing with "Missing required
 * scale: model.decoder.embed_tokens.weight_merged_0_scale", an ONNX
 * Runtime dequantization error, not anything under this app's control.
 * The same failure reproduces identically on onnx-community/whisper-tiny.en
 * (a separate HF org's re-conversion of the same checkpoint), so it's a
 * shared bug in the standard conversion pipeline, not a one-repo fluke. */
const MODEL_ID = "Xenova/whisper-tiny.en";
const MODEL_DTYPE = "fp32";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Transcriber = (pcm: Float32Array, options: Record<string, unknown>) => Promise<{ text?: string }>;

/**
 * Loads (once, lazily — first call triggers the model download) and runs
 * Whisper. A second instance sharing the same lazily-created pipeline is
 * intentional: the model is large enough that only one copy should ever be
 * resident.
 */
export class TransformersSpeechToTextEngine implements SpeechToTextEngine {
  private static pipelinePromise: Promise<Transcriber> | null = null;

  static isLoaded(): boolean {
    return TransformersSpeechToTextEngine.pipelinePromise !== null;
  }

  /** Explicitly triggers the (consent-gated) model download/load, so callers
   * can show progress before the first real transcription request needs it. */
  static preload(onProgress?: (fractionDone: number) => void): Promise<Transcriber> {
    if (!TransformersSpeechToTextEngine.pipelinePromise) {
      TransformersSpeechToTextEngine.pipelinePromise = buildPipeline(onProgress);
    }
    return TransformersSpeechToTextEngine.pipelinePromise;
  }

  async transcribe(pcm: Float32Array): Promise<string> {
    const transcriber = await TransformersSpeechToTextEngine.preload();
    // MODEL_ID is an English-only ("...en") checkpoint: it has no
    // multilingual task/language conditioning tokens at all, so passing
    // `language`/`task` (needed for multilingual Whisper checkpoints)
    // throws rather than being ignored.
    const output = await transcriber(pcm, {});
    return typeof output.text === "string" ? output.text.trim() : "";
  }
}

async function buildPipeline(onProgress?: (fractionDone: number) => void): Promise<Transcriber> {
  const { env, pipeline } = await import("@huggingface/transformers");

  // Without this, onnxruntime-web's own WASM runtime (distinct from the
  // Whisper model itself) defaults to fetching from a jsDelivr CDN on every
  // single load — not just the one-time model download. That would leave
  // the app unable to run inference at all without network access even
  // after the model is already cached, and adds a permanent dependency on
  // a third-party CDN's uptime. Instead it's bundled locally (see
  // package.json's "build" script) and loaded from disk like everything
  // else.
  env.backends.onnx.wasm!.wasmPaths = "./ort/";

  const transcriber = await pipeline("automatic-speech-recognition", MODEL_ID, {
    dtype: MODEL_DTYPE,
    progress_callback: onProgress
      ? (data: { status: string; progress?: number }) => {
          if (data.status === "progress" && typeof data.progress === "number") {
            onProgress(data.progress / 100);
          }
        }
      : undefined,
  });
  return transcriber as unknown as Transcriber;
}
