// Bundled by esbuild into a single dependency-free file (see package.json's
// "build" script) before it's loaded via a bare <script> tag with
// nodeIntegration disabled — there is no Node module system in that context,
// so the import below only works because it gets inlined at build time, the
// same treatment preload.ts needs for the same reason (see its own comment).
import {
  ConversationGuidance,
  ConversationSession,
  LlmGuidanceEngine,
  SpeakerChannel,
  TranscriptEvent,
} from "../shared/guidance";
import { SegmentResult, UtteranceSegmenter } from "./audio-segmenter";
import { SpeechToTextEngine, TransformersSpeechToTextEngine } from "./speech-to-text";
import { LocalLlmGuidanceEngine } from "./local-llm-guidance-engine";

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

// --- Speech-to-text ------------------------------------------------------
//
// Whisper expects mono PCM at 16kHz. A ScriptProcessorNode taps the same
// MediaStream the level meter above is already watching and delivers raw
// PCM chunks at that rate (Web Audio resamples getUserMedia/getDisplayMedia
// streams to the AudioContext's rate automatically). ScriptProcessorNode is
// deprecated in favor of AudioWorkletNode, but is kept for now since it
// needs no separate worklet module file to load/bundle; swap later if the
// deprecation warning becomes a real problem.
//
// Each channel gets its own UtteranceSegmenter (see audio-segmenter.ts) —
// Whisper isn't a streaming model, so this turns the continuous PCM stream
// into discrete finished utterances, which then get transcribed and fed
// into the same ConversationSession the guidance panel already reads from.

const STT_SAMPLE_RATE = 16_000;

/**
 * A ScriptProcessorNode only runs while connected through to a destination
 * (the Web Audio graph is pull-based), so its output is routed through a
 * zero-gain node rather than left disconnected — otherwise captured system
 * audio would be audibly replayed to the speakers, and mic audio would echo.
 */
function capturePcm(stream: MediaStream, onChunk: (chunk: Float32Array, nowMs: number) => void): () => void {
  const audioContext = new AudioContext({ sampleRate: STT_SAMPLE_RATE });
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  const silentGain = audioContext.createGain();
  silentGain.gain.value = 0;

  processor.onaudioprocess = (event) => {
    onChunk(new Float32Array(event.inputBuffer.getChannelData(0)), Date.now());
  };

  source.connect(processor);
  processor.connect(silentGain);
  silentGain.connect(audioContext.destination);

  return () => {
    processor.onaudioprocess = null;
    source.disconnect();
    processor.disconnect();
    silentGain.disconnect();
    void audioContext.close();
  };
}

let speechToTextEngine: SpeechToTextEngine = new TransformersSpeechToTextEngine();
let sttEnabled = false;

function renderTranscript(channel: SpeakerChannel, text: string): void {
  document.getElementById("transcript-channel")!.textContent = channel;
  document.getElementById("transcript-text")!.textContent = text;
}

async function handleSegment(channel: SpeakerChannel, segment: SegmentResult): Promise<void> {
  try {
    const text = await speechToTextEngine.transcribe(segment.pcm);
    if (!text) return; // Whisper can return empty output for near-silent/noise segments
    renderTranscript(channel, text);
    const event: TranscriptEvent = { text, channel, isFinal: true, timestampMs: segment.endedAtMs };
    renderGuidance(session.consume(event, renderGuidance));
  } catch (error) {
    console.error("transcription failed", error);
  }
}

/** Wires a stream into the transcription pipeline if speech-to-text has been
 * enabled; a no-op otherwise, so mic/system-audio level meters keep working
 * exactly as before regardless of whether STT consent was given. Returns a
 * stop function that flushes any in-progress utterance before tearing down. */
function wireTranscription(stream: MediaStream, channel: SpeakerChannel): () => void {
  if (!sttEnabled) return () => {};

  const segmenter = new UtteranceSegmenter();
  const stopCapture = capturePcm(stream, (chunk, nowMs) => {
    const segment = segmenter.pushChunk(chunk, nowMs);
    if (segment) void handleSegment(channel, segment);
  });

  return () => {
    const trailing = segmenter.flush(Date.now());
    stopCapture();
    if (trailing) void handleSegment(channel, trailing);
  };
}

async function startMicrophone(elements: LevelMeterElements): Promise<AudioSession | null> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    elements.status.textContent = "listening";
    const levelSession = driveLevelMeter(stream, elements);
    const stopTranscription = wireTranscription(stream, "me");
    return {
      stop() {
        stopTranscription();
        levelSession.stop();
      },
    };
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
    const levelSession = driveLevelMeter(stream, elements);
    const stopTranscription = wireTranscription(stream, "remote");
    return {
      stop() {
        stopTranscription();
        levelSession.stop();
      },
    };
  } catch (error) {
    elements.status.textContent = `error: ${(error as Error).message}`;
    return null;
  }
}

// --- Enable speech-to-text (consent-gated model download) ----------------

const enableSttButton = document.getElementById("enable-stt-button") as HTMLButtonElement;
const sttStatus = document.getElementById("stt-status")!;

async function enableSpeechToText(): Promise<void> {
  if (sttEnabled) return;
  enableSttButton.disabled = true;
  sttStatus.textContent = "downloading…";
  try {
    await TransformersSpeechToTextEngine.preload((fractionDone) => {
      sttStatus.textContent = `downloading… ${Math.round(fractionDone * 100)}%`;
    });
    sttEnabled = true;
    sttStatus.textContent = "ready";
    enableSttButton.hidden = true;
  } catch (error) {
    sttStatus.textContent = `error: ${(error as Error).message}`;
    enableSttButton.disabled = false;
  }
}

enableSttButton.addEventListener("click", () => void enableSpeechToText());

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
// Fed by handleSegment() above once speech-to-text is enabled and a channel
// finishes an utterance. Exposed on `window` (not through contextBridge/IPC,
// since it needs no main-process or native access) so it can also be driven
// directly — e.g. by tests, or anything else that already has recognized
// text and wants to skip audio capture entirely.

const session = new ConversationSession();

function renderGuidance(guidance: ConversationGuidance): void {
  const panel = document.getElementById("guidance-panel")!;
  panel.className = `row guidance-priority-${guidance.priority}`;
  document.getElementById("guidance-source")!.textContent = guidance.source;
  document.getElementById("guidance-headline")!.textContent = guidance.headline;
  document.getElementById("guidance-suggestion")!.textContent = guidance.suggestion;
}

renderGuidance(session.guidance);

// --- Enable local-LLM guidance upgrade (consent-gated model download) ----
//
// Purely additive: the rule-based guidance above is already fully
// functional and is never blocked on this. Once enabled, ConversationSession
// races this against the instant rule-based read on every turn and only
// upgrades the panel (tagged "llm") if it answers within its own ~1.8s
// budget — see src/main/llm/local-llm-engine.ts.

const enableLlmButton = document.getElementById("enable-llm-button") as HTMLButtonElement;
const llmStatus = document.getElementById("llm-status")!;
let llmEnabled = false;

async function enableLocalLlm(): Promise<void> {
  if (llmEnabled) return;
  enableLlmButton.disabled = true;
  llmStatus.textContent = "downloading…";
  const unsubscribe = window.sentimentAdvisor.onLocalLlmDownloadProgress((fractionDone) => {
    llmStatus.textContent = `downloading… ${Math.round(fractionDone * 100)}%`;
  });
  try {
    await window.sentimentAdvisor.enableLocalLlm();
    llmEnabled = true;
    llmStatus.textContent = "ready";
    enableLlmButton.hidden = true;
    session.attachLlmEngine(new LocalLlmGuidanceEngine());
  } catch (error) {
    llmStatus.textContent = `error: ${(error as Error).message}`;
    enableLlmButton.disabled = false;
  } finally {
    unsubscribe();
  }
}

enableLlmButton.addEventListener("click", () => void enableLocalLlm());

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

// Test-only seams. Harmless in a real session — nothing else calls them.
window.sentimentAdvisorTestHooks = {
  // Lets tests substitute a fake SpeechToTextEngine so the full mic-audio ->
  // segmenter -> transcription -> guidance pipeline can be exercised
  // deterministically, without downloading or running the real model.
  setSpeechToTextEngineForTesting(engine: SpeechToTextEngine): void {
    speechToTextEngine = engine;
    sttEnabled = true;
  },
  // The other direction: calls the *real* Whisper pipeline directly on
  // caller-supplied PCM, bypassing audio capture/segmentation entirely.
  // This is what actually proves real speech is transcribed correctly —
  // dependency-injecting a fake engine (above) can only ever prove the
  // wiring around it is correct, never that transcription itself works.
  transcribeForTesting(pcm: number[]): Promise<string> {
    return new TransformersSpeechToTextEngine().transcribe(Float32Array.from(pcm));
  },
  // Lets tests attach a fake LlmGuidanceEngine to exercise the racing/
  // upgrade behavior deterministically, without downloading or running the
  // real ~490MB model.
  setLlmGuidanceEngineForTesting(engine: LlmGuidanceEngine): void {
    llmEnabled = true;
    session.attachLlmEngine(engine);
  },
};

declare global {
  interface Window {
    sentimentAdvisorGuidance: {
      ingestTranscriptEvent(event: TranscriptEvent): ConversationGuidance;
      reset(): void;
    };
    sentimentAdvisorTestHooks: {
      setSpeechToTextEngineForTesting(engine: SpeechToTextEngine): void;
      transcribeForTesting(pcm: number[]): Promise<string>;
      setLlmGuidanceEngineForTesting(engine: LlmGuidanceEngine): void;
    };
  }
}
