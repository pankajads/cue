# Sentiment Advisor

A local, on-device conversation-sentiment advisor for macOS, Windows, and Linux. It listens during a call (your microphone and, separately, the other side's audio), reads the tone of the conversation as it happens, and surfaces short, concrete guidance in a tray popover — entirely on-device, with no audio or transcript ever leaving the machine.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full pipeline design, including the planned local-LLM guidance upgrade.

## Status

**End to end and test-covered** (`npm test` — 36 automated tests, unit/integration/e2e, no manual clicking required): mic audio now flows all the way through to real transcription and guidance, not just level meters.

- Tray-only app shell (no Dock icon), frameless popover window, a narrow typed IPC bridge (`contextIsolation` on, `nodeIntegration` off).
- System/"remote" audio source resolution via `desktopCapturer` — the permission/decision logic is unit-tested against fake platform state.
- The app launches, creates its tray, and quits cleanly — verified by spawning the real built app in a real Electron runtime.
- Clicking **Start listening** (now a real Start/Stop toggle) wires a `MediaStream` to a live `AnalyserNode` and drives the level meters from real audio — verified end-to-end over Chromium's DevTools Protocol (not macOS Accessibility APIs, so it needs no special permission and runs headlessly).
- **Speech-to-text, in-renderer, no native addon**: `@huggingface/transformers` runs Whisper (`Xenova/whisper-tiny.en`) over WASM directly in the popover's renderer process — see [ARCHITECTURE.md](ARCHITECTURE.md#speech-to-text) for why this beat a native whisper.cpp binding on reliability grounds, and the real bugs (a broken quantized model export, a CDN-dependent WASM runtime, three separate CSP gaps) that a real, unstubbed test caught and this fixes.
- A finished utterance (detected by a simple energy-based `UtteranceSegmenter`) is transcribed and fed straight into the same rule-based guidance engine below — the whole pipeline is real, not a demo stub.
- The rule-based sentiment/tension/guidance engine (`src/shared/guidance/`) — unit-tested extensively, and validated against two full realistic conversation transcripts (a frustrated customer support call, and an HR warning to an SRE about rudeness and repeated lateness), both at the algorithm level and end-to-end through the real UI. See [ARCHITECTURE.md](ARCHITECTURE.md#guidance-engine) for how it works and [tests/fixtures/conversation-scenarios.ts](tests/fixtures/conversation-scenarios.ts) for the transcripts themselves.
- **A real reliability test, not just a wiring test**: `npm run test:reliability` synthesizes actual speech with macOS's `say`, runs it through the *real*, unstubbed Whisper pipeline (no fakes), and asserts the expected words come back. This is deliberately separate from `npm test`/CI (network-dependent, downloads the real ~150MB model, macOS-only tooling) but is what actually backs the "highly reliable" bar for this feature — every other STT test fakes the transcription engine to stay fast and deterministic, which proves the plumbing works but never that transcription itself does.

**Not yet verified** — needs a human, because it's gated behind a one-time OS permission dialog no automated tool can click through in a headless environment:
- Whether real hardware microphone audio actually delivers usable data once you personally grant the mic permission prompt.

**Known real limitation, not a bug to report twice**: system/"remote" audio used to crash the whole popover on click (a real Electron bug — audio-only `getUserMedia({mandatory:{chromeMediaSource:'desktop',...}})` kills the renderer process). That crash is fixed (see [ARCHITECTURE.md](ARCHITECTURE.md#audio-capture)) by switching to `getDisplayMedia` + `setDisplayMediaRequestHandler`, which is Electron's own current answer — but Electron 44's shipped types document loopback audio there as **Windows-only today**. On macOS, expect the system-audio meter to degrade gracefully to "unavailable" rather than crash, not to show real captured audio yet. This is an open architectural question, not a quick fix — see ARCHITECTURE.md for the options.

**Not yet built:**
- The local-LLM guidance upgrade (`node-llama-cpp`) — the interface it plugs into already exists and is fully wired (`LlmGuidanceEngine` in `src/shared/guidance/conversation-session.ts`), but no concrete implementation exists yet. See [ARCHITECTURE.md](ARCHITECTURE.md#planned-local-llm-upgrade).
- Packaging/release automation (`electron-builder` config exists; no CI publish step yet).

## Try it

```sh
npm install
npm test   # builds, then runs the full unit/integration/e2e suite
npm run dev
```

Click the tray icon, then **Enable live transcription** (downloads the ~150MB Whisper model once, cached after that) and **Start listening**. The OS will prompt for microphone and (for the system-audio meter) screen-recording permission — screen-recording is what desktop audio capture is gated behind on macOS. Speak, and the guidance panel should update from your real, transcribed words.

## Testing

Tests are split into layers under `tests/`, each independently runnable:

| Layer | What it covers | Needs Electron? |
|---|---|---|
| `tests/unit/` | Pure logic: audio-source decision-making, the sentiment/tension analyzer, the guidance advisor, session state, the utterance segmenter — including the two full conversation-scenario fixtures | No — plain `node --test` |
| `tests/integration/` | The real app launching in a real Electron process, becoming ready, and quitting cleanly | Yes — spawns the built app |
| `tests/e2e/` | The real UI, driven over Chromium's DevTools Protocol: clicking Start/Stop listening, replaying the conversation fixtures through the actual guidance panel's DOM, and the full mic → segmenter → (fake) transcription → guidance pipeline | Yes — drives the built app with `playwright-core` |
| `tests/reliability/` | The *real*, unstubbed Whisper pipeline transcribing *real* synthesized speech — see Status above | Yes, plus macOS's `say`/`afconvert` and network access |

```sh
npm run test:unit
npm run test:integration
npm run test:e2e
npm test               # unit + integration + e2e, in order
npm run test:reliability   # separate — see why in Status above
```

## Why Electron

Audio capture is the interesting architectural bet: mic input is plain `navigator.mediaDevices.getUserMedia`, and system/"remote" audio ("what you hear") uses Electron's `getDisplayMedia`/`desktopCapturer` — no third-party virtual audio driver (e.g. BlackHole) needed, at least on Windows today (see [ARCHITECTURE.md](ARCHITECTURE.md#audio-capture) for the honest macOS caveat). Linux support is expected to be weaker (compositor/PulseAudio-dependent) and may need a manual monitor-source fallback.

Speech-to-text is the same bet again, one layer up: Whisper runs entirely in-renderer via WASM (`@huggingface/transformers`), not a native whisper.cpp addon — because the renderer is already a real Chromium context, that's a much smaller reliability risk than a per-platform native binary matrix (see [ARCHITECTURE.md](ARCHITECTURE.md#speech-to-text)). The guidance logic itself (`src/shared/guidance/`) is pure TypeScript with no platform dependency at all, so it runs identically on all three OSes.
