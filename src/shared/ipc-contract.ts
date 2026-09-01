// Shared IPC channel names and payload types between main, preload, and
// renderer. Single source of truth so the contextBridge surface in preload.ts
// and the calls in renderer.ts can't silently drift from what main.ts handles.

import { ConversationTurn, LlmAdvice } from "./guidance";

export const IPC = {
  getSystemAudioSourceId: "audio:getSystemAudioSourceId",
  llmEnable: "llm:enable",
  llmEnableProgress: "llm:enableProgress",
  llmIsReady: "llm:isReady",
  llmAdvise: "llm:advise",
} as const;

export interface SentimentAdvisorAPI {
  /**
   * Returns a desktopCapturer source id suitable for
   * navigator.mediaDevices.getUserMedia({
   *   audio: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id } }
   * })
   * to capture system/"remote" audio — the job a third-party virtual audio
   * driver like BlackHole would otherwise be needed for on macOS.
   * Resolves to null if no capturable source with audio was found (e.g.
   * platform/permission limitation) — callers should fall back to mic-only.
   */
  getSystemAudioSourceId(): Promise<string | null>;

  /**
   * Consent-gated: triggers the one-time local-LLM model download (if not
   * already cached) and loads it into memory. Resolves once the model is
   * ready to answer `adviseWithLocalLlm` calls; rejects if the download or
   * load fails. Safe to call more than once — idempotent.
   */
  enableLocalLlm(): Promise<void>;

  /** Subscribes to download-progress updates (0..1) while enableLocalLlm()'s
   * download is in flight. Returns an unsubscribe function. */
  onLocalLlmDownloadProgress(callback: (fractionDone: number) => void): () => void;

  isLocalLlmReady(): Promise<boolean>;

  /**
   * Asks the local LLM (running in the main process — llama.cpp bindings
   * can't run in a sandboxed renderer) to analyze the given turns and
   * propose sentiment/tension/guidance. Rejects if the model isn't loaded,
   * or after its own internal ~1.8s timeout — the same hard budget the
   * original design uses, enforced inside the main-process engine, not
   * here.
   */
  adviseWithLocalLlm(recentTurns: ConversationTurn[]): Promise<LlmAdvice>;
}
