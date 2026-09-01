// Shared IPC channel names and payload types between main, preload, and
// renderer. Single source of truth so the contextBridge surface in preload.ts
// and the calls in renderer.ts can't silently drift from what main.ts handles.

export const IPC = {
  getSystemAudioSourceId: "audio:getSystemAudioSourceId",
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
}
