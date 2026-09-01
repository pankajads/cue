# Sentiment Advisor (Electron)

Cross-platform (macOS/Windows/Linux) rewrite of the original [macOS-native Sentiment Advisor](https://github.com/pankajads/sentiment-analyser-advisor), using Electron + TypeScript so the same local, on-device conversation-analysis idea can run on Windows and Linux, not just macOS.

## Status: early scaffold, core wiring test-covered

What's built and verified — by an automated test suite (`npm test`), not manual clicking:
- Tray-only app shell (no Dock icon), frameless popover window, IPC bridge — mirrors the original app's `AppDelegate`/`StatusPopover` structure.
- Builds cleanly, zero `npm audit` vulnerabilities.
- Launches without crashing (main process + GPU/network helper processes all healthy), quits cleanly — `src/main/main.smoke.test.ts` spawns the real built app and asserts this.
- The system-audio permission/source-resolution decision logic (`src/main/audio-sources.ts`) — unit-tested in `audio-sources.test.ts` against fake deps, since `electron` itself can't be `require`d for its real API outside a running Electron process.
- Clicking **Start listening** actually wires a MediaStream to a live `AnalyserNode` and drives the level meter from real audio data flowing through it — `src/main/start-listening.e2e.test.ts` drives the real app over Chromium's DevTools Protocol (not macOS Accessibility APIs, so it needs no Accessibility permission and works headlessly), with `navigator.mediaDevices.getUserMedia` swapped for a real Web Audio oscillator instead of a real mic. This test is what caught and pinned down a real bug: Electron's sandboxed preload (default since Electron 20) can't resolve a relative `require` to another local module, so `preload.ts`'s import of `../shared/ipc-contract` silently failed at runtime and `window.sentimentAdvisor` was `undefined` on every launch. Fixed by bundling the preload into one dependency-free file with esbuild (`npm run build`'s second step) rather than disabling the sandbox.

What's still **not** verified — needs a human, because it's gated behind a one-time OS permission dialog no automated tool in this environment can click through:
- Whether real hardware microphone/system audio actually delivers data once you personally grant the mic and screen-recording permission prompts — the CDP-driven test above proves the plumbing works with synthetic audio, but not that a real BlackHole-free desktop-audio capture path produces usable signal from your actual mic/speakers.

## Try it

```sh
npm install
npm test   # automated: builds, then runs the unit/smoke/e2e suite above
npm run dev
```

For the one piece that still needs you: click the tray icon, then **Start listening**. macOS will prompt for microphone and (for the system-audio meter) screen-recording permission — screen-recording is what macOS gates desktopCapturer audio behind, same TCC system the original app's mic/Speech-recognition prompts used.

## Why Electron, and what's actually portable

See the parent project's conversation history for the full reasoning. Short version: the original app's core logic (sentiment/tension scoring, the local-LLM guidance layer) has no macOS-specific dependency and is a near-direct port. What had to change is audio capture (BlackHole → Electron's `desktopCapturer`, which needs no third-party virtual driver on macOS 13+/Windows), speech-to-text (Apple's Speech framework → a cross-platform whisper.cpp binding, not yet wired in), and the UI shell (SwiftUI → Electron's `Tray` + a small `BrowserWindow`).

## Not yet ported from the original app

- Speech-to-text (whisper.cpp binding)
- Local LLM guidance (`node-llama-cpp`)
- The rule-based `SignalAnalyzer`/`GuidanceAdvisor` logic
- CI, packaging/release automation
