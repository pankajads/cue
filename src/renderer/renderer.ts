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

/** A running capture: holds everything that needs tearing down on stop. */
interface AudioSession {
  stop(): void;
}

/**
 * Wires a MediaStream to an AnalyserNode and drives a level-meter element's
 * width from RMS. Returns a handle to stop it — cancels the meter's
 * animation loop, stops every track (releasing the mic/screen-capture
 * indicator), and closes the AudioContext, rather than leaking all three
 * forever once the user clicks "Stop listening".
 */
function driveLevelMeter(stream: MediaStream, elements: LevelMeterElements): AudioSession {
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);

  const buffer = new Float32Array(analyser.fftSize);
  let animationFrameId: number | null = null;
  let stopped = false;

  function tick() {
    if (stopped) return;
    analyser.getFloatTimeDomainData(buffer);
    let sumSquares = 0;
    for (const sample of buffer) {
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / buffer.length);
    elements.fill.style.width = `${Math.min(rms * 500, 100)}%`;
    animationFrameId = requestAnimationFrame(tick);
  }
  animationFrameId = requestAnimationFrame(tick);

  return {
    stop() {
      stopped = true;
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
      stream.getTracks().forEach((track) => track.stop());
      void audioContext.close();
      elements.fill.style.width = "0%";
    },
  };
}

async function startMicrophone(elements: LevelMeterElements): Promise<AudioSession | null> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    elements.status.textContent = "listening";
    return driveLevelMeter(stream, elements);
  } catch (error) {
    elements.status.textContent = `error: ${(error as Error).message}`;
    return null;
  }
}

async function startSystemAudio(elements: LevelMeterElements): Promise<AudioSession | null> {
  try {
    const sourceId = await window.sentimentAdvisor.getSystemAudioSourceId();
    if (!sourceId) {
      elements.status.textContent = "unavailable (permission or platform)";
      return null;
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
      return null;
    }

    elements.status.textContent = "listening";
    return driveLevelMeter(stream, elements);
  } catch (error) {
    elements.status.textContent = `error: ${(error as Error).message}`;
    return null;
  }
}

// --- Start/Stop toggle ---------------------------------------------------

const startButton = document.getElementById("start-button") as HTMLButtonElement;
let activeSessions: AudioSession[] = [];
let listening = false;
// Bumped on every start/stop. Mic and system audio resolve independently (an
// IPC round-trip for the latter) — batching them behind a single Promise.all
// before touching activeSessions would leave a window where a fast
// Start-then-Stop click finds activeSessions still empty and stops nothing,
// so whichever capture had already started keeps running with no button
// left to stop it. Each one is instead attached (or, if a stop already
// happened by the time it resolves, immediately stopped) on its own.
let listenGeneration = 0;

function attachWhenReady(pending: Promise<AudioSession | null>, generation: number): void {
  void pending.then((session) => {
    if (!session) return;
    if (generation !== listenGeneration) {
      session.stop();
      return;
    }
    activeSessions.push(session);
  });
}

function startListening(): void {
  if (listening) return;
  listening = true;
  // Flipped immediately, not after mic/system-audio settle: the button
  // represents the user's stated intent ("I clicked Start"), not whether
  // every capture attempt has finished negotiating.
  startButton.textContent = "Stop listening";
  const generation = ++listenGeneration;
  attachWhenReady(startMicrophone(meter("mic")), generation);
  attachWhenReady(startSystemAudio(meter("system")), generation);
}

function stopListening(): void {
  listenGeneration += 1;
  activeSessions.forEach((session) => session.stop());
  activeSessions = [];
  listening = false;
  startButton.textContent = "Start listening";
  meter("mic").status.textContent = "not started";
  meter("system").status.textContent = "not started";
}

startButton.addEventListener("click", () => {
  if (listening) {
    stopListening();
  } else {
    startListening();
  }
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
