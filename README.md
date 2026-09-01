# Sentiment Advisor

A local, on-device conversation-sentiment advisor for macOS, Windows, and Linux. It listens during a call (your microphone and, separately, the other side's audio), reads the tone of the conversation as it happens, and surfaces short, concrete guidance in a tray popover — entirely on-device, with no audio or transcript ever leaving the machine.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full pipeline design, including the planned local-LLM guidance upgrade.

## Status

**Built and test-covered** (`npm test` — 25 automated tests, unit/integration/e2e, no manual clicking required):
- Tray-only app shell (no Dock icon), frameless popover window, a narrow typed IPC bridge (`contextIsolation` on, `nodeIntegration` off).
- System/"remote" audio source resolution via `desktopCapturer` — the permission/decision logic is unit-tested against fake platform state.
- The app launches, creates its tray, and quits cleanly — verified by spawning the real built app in a real Electron runtime.
- Clicking **Start listening** wires a `MediaStream` to a live `AnalyserNode` and drives the level meters from real audio — verified end-to-end over Chromium's DevTools Protocol (not macOS Accessibility APIs, so it needs no special permission and runs headlessly), with `getUserMedia` swapped for a Web Audio oscillator instead of real mic/desktop hardware.
- The rule-based sentiment/tension/guidance engine (`src/shared/guidance/`) — unit-tested extensively, and validated against two full realistic conversation transcripts (a frustrated customer support call, and an HR warning to an SRE about rudeness and repeated lateness), both at the algorithm level and end-to-end through the real UI. See [ARCHITECTURE.md](ARCHITECTURE.md#guidance-engine) for how it works and [tests/fixtures/conversation-scenarios.ts](tests/fixtures/conversation-scenarios.ts) for the transcripts themselves.

**Not yet verified** — needs a human, because it's gated behind a one-time OS permission dialog no automated tool can click through in a headless environment:
- Whether real hardware microphone/system audio actually delivers usable data once you personally grant the mic and screen-recording permission prompts.

**Not yet built:**
- Speech-to-text (a whisper.cpp Node binding — not yet evaluated/chosen).
- The local-LLM guidance upgrade (`node-llama-cpp`) — the interface it plugs into already exists and is fully wired (`LlmGuidanceEngine` in `src/shared/guidance/conversation-session.ts`), but no concrete implementation exists yet. See [ARCHITECTURE.md](ARCHITECTURE.md#planned-local-llm-upgrade).
- Packaging/release automation (`electron-builder` config exists; no CI publish step yet).

## Try it

```sh
npm install
npm test   # builds, then runs the full unit/integration/e2e suite
npm run dev
```

For the one piece that still needs a human: click the tray icon, then **Start listening**. The OS will prompt for microphone and (for the system-audio meter) screen-recording permission — screen-recording is what desktop audio capture is gated behind on macOS.

## Testing

Tests are split into three layers under `tests/`, each independently runnable:

| Layer | What it covers | Needs Electron? |
|---|---|---|
| `tests/unit/` | Pure logic: audio-source decision-making, the sentiment/tension analyzer, the guidance advisor, session state — including the two full conversation-scenario fixtures | No — plain `node --test` |
| `tests/integration/` | The real app launching in a real Electron process, becoming ready, and quitting cleanly | Yes — spawns the built app |
| `tests/e2e/` | The real UI, driven over Chromium's DevTools Protocol: clicking "Start listening", and replaying the conversation fixtures through the actual guidance panel's DOM | Yes — drives the built app with `playwright-core` |

```sh
npm run test:unit
npm run test:integration
npm run test:e2e
npm test   # all three, in order
```

## Why Electron

Audio capture is the interesting architectural bet: mic input is plain `navigator.mediaDevices.getUserMedia`, and system/"remote" audio ("what you hear") uses Electron's `desktopCapturer` with a `chromeMediaSourceId` constraint — no third-party virtual audio driver (e.g. BlackHole) needed on macOS 13+ or Windows. Linux support is expected to be weaker (compositor/PulseAudio-dependent) and may need a manual monitor-source fallback. The guidance logic itself (`src/shared/guidance/`) is pure TypeScript with no platform dependency at all, so it runs identically on all three OSes.
