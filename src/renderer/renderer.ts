// Deliberately no import/export statements: this compiles to plain CommonJS
// and loads via a bare <script> tag with nodeIntegration disabled, so it must
// not reference `exports`/`require` at runtime. `window.sentimentAdvisor` is
// the only bridge into main-process capability (see preload.ts).

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
 * width from RMS, the same signal shape as the original app's
 * AudioLevelMeter.swift — a direct behavioral port, not a redesign.
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

    // The chromeMediaSource/chromeMediaSourceId constraint pair is Electron's
    // (non-standard, hence the `as any`) extension for routing a
    // desktopCapturer source into getUserMedia.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "desktop",
          chromeMediaSourceId: sourceId,
        },
      },
    } as unknown as MediaStreamConstraints);

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
