# Sentiment Advisor (Electron)

Cross-platform (macOS/Windows/Linux) rewrite of the original [macOS-native Sentiment Advisor](https://github.com/pankajads/sentiment-analyser-advisor), using Electron + TypeScript so the same local, on-device conversation-analysis idea can run on Windows and Linux, not just macOS.

## Status: early scaffold, unproven on real audio yet

What's built and verified:
- Tray-only app shell (no Dock icon), frameless popover window, IPC bridge — mirrors the original app's `AppDelegate`/`StatusPopover` structure.
- Builds cleanly, zero `npm audit` vulnerabilities.
- Launches without crashing (main process + GPU/network helper processes all healthy), quits cleanly.

What's **not** verified yet — needs a real click, not something scriptable:
- Whether `navigator.mediaDevices.getUserMedia` (mic) and `desktopCapturer` + `getUserMedia` (system/"remote" audio — the cross-platform replacement for the original app's BlackHole dependency) actually deliver real audio data once mic/screen-recording permission is granted.

## Try it

```sh
npm install
npm run dev
```

Click the tray icon, then **Start listening**. macOS will prompt for microphone and (for the system-audio meter) screen-recording permission — screen-recording is what macOS gates desktopCapturer audio behind, same TCC system the original app's mic/Speech-recognition prompts used.

## Why Electron, and what's actually portable

See the parent project's conversation history for the full reasoning. Short version: the original app's core logic (sentiment/tension scoring, the local-LLM guidance layer) has no macOS-specific dependency and is a near-direct port. What had to change is audio capture (BlackHole → Electron's `desktopCapturer`, which needs no third-party virtual driver on macOS 13+/Windows), speech-to-text (Apple's Speech framework → a cross-platform whisper.cpp binding, not yet wired in), and the UI shell (SwiftUI → Electron's `Tray` + a small `BrowserWindow`).

## Not yet ported from the original app

- Speech-to-text (whisper.cpp binding)
- Local LLM guidance (`node-llama-cpp`)
- The rule-based `SignalAnalyzer`/`GuidanceAdvisor` logic
- CI, packaging/release automation
