// Bundled by esbuild into a single dependency-free file (see package.json's
// "build" script) before it's loaded via a bare <script> tag with
// nodeIntegration disabled — there is no Node module system in that context,
// so the import below only works because it gets inlined at build time, the
// same treatment preload.ts needs for the same reason (see its own comment).
import {
  ConversationGuidance,
  ConversationSession,
  TranscriptEvent,
} from "../shared/guidance";

interface LevelMeterElements {
  status: HTMLElement;
  fill: HTMLElement;
}

function meter(prefix: "mic" | "system"): LevelMeterElements {
  return {
    status: document.getElementById(`${prefix}-status`)!,
    fill: document.getElementById(`${prefix}-level`)!,
  };
}

/**
 * Wires a MediaStream to an AnalyserNode and drives a level-meter element's
 * width from RMS.
 */
function driveLevelMeter(stream: MediaStream, elements: LevelMeterElements): void {
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  const buffer = new Float32Array(analyser.fftSize);

  function tick() {
    analyser.getFloatTimeDomainData(buffer);
    let sumSquares = 0;
    for (const sample of buffer) {
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / buffer.length);
    elements.fill.style.width = `${Math.min(rms * 500, 100)}%`;
    requestAnimationFrame(tick);
  }
  tick();
}

async function startMicrophone(elements: LevelMeterElements): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    elements.status.textContent = "listening";
    driveLevelMeter(stream, elements);
  } catch (error) {
    elements.status.textContent = `error: ${(error as Error).message}`;
  }
}

async function startSystemAudio(elements: LevelMeterElements): Promise<void> {
  try {
    const sourceId = await window.sentimentAdvisor.getSystemAudioSourceId();
    if (!sourceId) {
      elements.status.textContent = "unavailable (permission or platform)";
      return;
    }

    // getUserMedia with the legacy { mandatory: { chromeMediaSource:
    // 'desktop', ... } } constraint crashes the whole renderer process on
    // an audio-only request (Chromium: "bad IPC message, reason 263") —
    // it does not fail gracefully, so this is not optional. getDisplayMedia
    // is the current officially supported replacement; main.ts's
    // setDisplayMediaRequestHandler answers this call and requests loopback
    // audio on the primary screen source. A 1x1 video track is requested
    // only because getDisplayMedia requires it — it's discarded immediately
    // below, since only the audio track is used.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: { width: 1, height: 1 },
    });

    stream.getVideoTracks().forEach((track) => {
      track.stop();
      stream.removeTrack(track);
    });

    if (stream.getAudioTracks().length === 0) {
      // Reachable today on platforms where Electron's loopback audio isn't
      // supported yet (see ARCHITECTURE.md) — a real gap, not a bug in this
      // code: getDisplayMedia succeeded but delivered no audio track.
      elements.status.textContent = "unavailable (no system audio track on this platform)";
      return;
    }

    elements.status.textContent = "listening";
    driveLevelMeter(stream, elements);
  } catch (error) {
    elements.status.textContent = `error: ${(error as Error).message}`;
  }
}

document.getElementById("start-button")!.addEventListener("click", () => {
  void startMicrophone(meter("mic"));
  void startSystemAudio(meter("system"));
});

// --- Sentiment/guidance panel -------------------------------------------
//
// No speech-to-text is wired in yet (see README), so nothing calls this in
// a real user session today. It's wired up now, ahead of that, because it's
// pure logic with no platform dependency (see src/shared/guidance) and this
// is the exact integration point the STT binding will call once it exists —
// one TranscriptEvent per interim/final recognition result, same shape
// either way. Exposed on `window` rather than through contextBridge/IPC
// because it needs no main-process or native access at all.

const session = new ConversationSession();

function renderGuidance(guidance: ConversationGuidance): void {
  const panel = document.getElementById("guidance-panel")!;
  panel.className = `row guidance-priority-${guidance.priority}`;
  document.getElementById("guidance-source")!.textContent = guidance.source;
  document.getElementById("guidance-headline")!.textContent = guidance.headline;
  document.getElementById("guidance-suggestion")!.textContent = guidance.suggestion;
}

renderGuidance(session.guidance);

window.sentimentAdvisorGuidance = {
  ingestTranscriptEvent(event: TranscriptEvent): ConversationGuidance {
    const guidance = session.consume(event, renderGuidance);
    renderGuidance(guidance);
    return guidance;
  },
  reset(): void {
    session.reset();
    renderGuidance(session.guidance);
  },
};

declare global {
  interface Window {
    sentimentAdvisorGuidance: {
      ingestTranscriptEvent(event: TranscriptEvent): ConversationGuidance;
      reset(): void;
    };
  }
}
