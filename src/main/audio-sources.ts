import { desktopCapturer, ipcMain, systemPreferences } from "electron";
import { IPC } from "../shared/ipc-contract";

/**
 * System/"remote" audio capture, the cross-platform replacement for the
 * Swift app's BlackHole dependency. Electron's desktopCapturer + a
 * chromeMediaSourceId constraint on getUserMedia gives loopback-style
 * "what you hear" capture without any third-party virtual audio driver on
 * macOS (13+) and Windows. Linux support is weaker (depends on the
 * compositor/PulseAudio setup) — this deliberately returns null rather than
 * throwing when no usable source exists, so callers degrade to mic-only,
 * matching the original app's "microphone-only degraded mode" pattern.
 */
export function registerAudioSourceHandlers(): void {
  ipcMain.handle(IPC.getSystemAudioSourceId, async () => {
    if (process.platform === "darwin") {
      // Screen/audio recording on macOS is gated by TCC just like the
      // Speech/Microphone permissions in the original app.
      const status = systemPreferences.getMediaAccessStatus("screen");
      if (status !== "granted") {
        return null;
      }
    }

    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      fetchWindowIcons: false,
    });

    // On a single-display machine the primary screen source's audio track
    // (when Chromium's loopback support is available on this platform) is
    // what a real "capture whatever is playing" flow wants — the app-level
    // audio-source *picker* to let a user choose can come later; this proves
    // the underlying platform capability first.
    return sources.length > 0 ? sources[0].id : null;
  });
}
