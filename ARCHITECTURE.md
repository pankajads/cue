# Architecture

## Process layout

Standard Electron three-process split, kept as narrow as possible at the boundaries:

```mermaid
flowchart TB
    subgraph Main["Main process (Node, full access)"]
        Tray["Tray + popover BrowserWindow"]
        AudioSrc["audio-sources.ts<br/>resolveSystemAudioSourceId()"]
        Tray --> AudioSrc
    end

    subgraph Preload["Preload (sandboxed, bundled to one file)"]
        Bridge["contextBridge.exposeInMainWorld<br/>('sentimentAdvisor', ...)"]
    end

    subgraph Renderer["Renderer (contextIsolation on, nodeIntegration off)"]
        UI["popover UI: level meters + guidance panel"]
        Session["ConversationSession<br/>(SignalAnalyzer + GuidanceAdvisor)"]
        UI <--> Session
    end

    AudioSrc <-- "ipcMain.handle /<br/>ipcRenderer.invoke" --> Bridge
    Bridge -- "window.sentimentAdvisor" --> UI
```

The preload script imports from `src/shared/` (e.g. `ipc-contract.ts`), but Electron's default sandboxed preload can only `require` a small built-in whitelist — it cannot resolve a relative `require` to another local module. Both `preload.ts` and `renderer.ts` are bundled into a single dependency-free file with esbuild at build time (see `package.json`'s `build` script) rather than disabling the sandbox. This was a real bug caught by `tests/e2e/start-listening.test.ts`: before the bundling step existed, the preload's import silently failed at runtime and `window.sentimentAdvisor` was `undefined` on every launch.

## Guidance engine

`src/shared/guidance/` is pure TypeScript with zero platform dependency — no Electron, DOM, or Node API — so it is unit-testable in plain Node and identical on all three target OSes.

```mermaid
flowchart LR
    STT["Speech-to-text<br/>(planned: whisper.cpp binding)"] -- "TranscriptEvent<br/>(interim/final)" --> Session["ConversationSession"]
    Session -- "ConversationTurn[]" --> Analyzer["SignalAnalyzer<br/>lexicon sentiment + tension"]
    Analyzer -- "SignalSnapshot" --> Advisor["GuidanceAdvisor<br/>(stateful, escalates wording<br/>across repeated turns)"]
    Advisor -- "ConversationGuidance<br/>(source: rules)" --> Panel["Guidance panel<br/>(instant, always available)"]

    Session -. "same ConversationTurn[],<br/>raced with ~1.8s timeout" .-> LLM["LlmGuidanceEngine<br/>(planned: node-llama-cpp)"]
    LLM -. "ConversationGuidance<br/>(source: llm), if it wins the race" .-> Panel
```

- **`SignalAnalyzer`** scores each turn against a small fixed lexicon (no ML, no network call), aggregates over a rolling window of the last 8 turns, and combines interruption rate, speaking pace, and pause length into a tension score.
- **`GuidanceAdvisor`** maps `(sentiment, tension, unansweredQuestion)` to one of a handful of categories and a canned suggestion. It is *stateful*: it tracks how many consecutive turns the same category has held and escalates its wording instead of repeating itself — e.g. "Acknowledge the frustration out loud..." on the first urgent turn becomes "Still critical after 3 turns — naming an apology again won't land twice..." if the situation persists.
- **`ConversationSession`** is the orchestrator: turns interim/final `TranscriptEvent`s into `ConversationTurn`s, runs the two pieces above on every finalized turn, and — if an `LlmGuidanceEngine` is attached — races it against a generation counter so a slow or stale LLM response can never overwrite guidance for a newer turn, and can never block the instant rule-based result.

This design, and the two conversation fixtures it's validated against (a de-escalating customer-support call and an escalating HR warning — see `tests/fixtures/conversation-scenarios.ts`), is covered by `tests/unit/conversation-scenarios.test.ts` (algorithm correctness) and `tests/e2e/conversation-scenarios.test.ts` (same fixtures, replayed through the real UI over CDP).

## Planned: local-LLM upgrade

No concrete `LlmGuidanceEngine` exists yet — until one is attached, every session runs on the rule-based path alone, which is a fully supported permanent mode, not a degraded fallback. The planned implementation:

- **`node-llama-cpp`**, running a small instruct model in-process (no external server, no Ollama, no network call) — the same on-device, no-cloud guarantee as the rest of the app.
- **Grammar-constrained (GBNF) JSON output** — `{"sentiment": ..., "tension": ..., "guidance": ...}` with the string length capped in the grammar itself — so a small model's output is reliably parseable without trusting free-text obedience.
- **Raced against a ~1.8s hard timeout**, per turn, via the same `generation`-counter mechanism already implemented in `ConversationSession`. The rule-based guidance is the hard latency guarantee; the LLM only ever *upgrades* it when it lands in time.
- **Consent-gated model download** with progress and integrity verification, matching the app's on-device-only, nothing-leaves-the-machine positioning.
- The UI already renders a `source` tag (`rules` vs `llm`) on every guidance card, wired and tested now, ahead of there being an LLM to tag.

## Audio capture

- **Microphone**: plain `navigator.mediaDevices.getUserMedia({ audio: true })` in the renderer — no native audio module needed.
- **System/"remote" audio**: `navigator.mediaDevices.getDisplayMedia({ audio: true, video: {...} })` in the renderer, answered by `session.setDisplayMediaRequestHandler` in `main.ts`, which auto-selects the primary screen source via `desktopCapturer` and requests `audio: 'loopback'` on it (`src/main/audio-sources.ts` still does the up-front TCC-permission/source-exists check used for the UI's "unavailable" message).

  **Platform reality check, not the original plan**: the original architectural bet was that Electron's `desktopCapturer` would give loopback-style system audio on both macOS 13+ and Windows with no third-party virtual audio driver (unlike the BlackHole dependency this app's audio model is otherwise modeled to avoid). That held only partly. The legacy API for this — `getUserMedia({ audio: { mandatory: { chromeMediaSource: 'desktop', ... } } })` — turned out to **crash the entire renderer process** on an audio-only request (Chromium: `Terminating renderer for bad IPC message, reason 263 / DESKTOP_CAPTURER_INVALID_OR_UNKNOWN_ID`), a known upstream Electron issue, not something fixable by calling it differently. The `getDisplayMedia` + `setDisplayMediaRequestHandler` replacement above is Electron's own currently-documented answer, and it does fix the crash — but Electron 44's own shipped type declarations state `audio: 'loopback'` is **"currently only supported on Windows."** On macOS today, this path degrades gracefully (an audio-less track, or a rejected `getDisplayMedia` call) rather than crashing, but does not yet deliver real captured system audio. Linux is unverified either way. Real system audio on macOS, if wanted before Electron itself closes this gap, would need either a native audio-tap module (e.g. macOS 14.2+'s ScreenCaptureKit Core Audio Tap APIs) or falling back to a virtual audio driver after all — an open decision, not yet made.
- **Speech-to-text**: not yet wired in. A whisper.cpp Node binding is planned; which one (`whisper-node` / `nodejs-whisper` / `smart-whisper` / Transformers.js's ONNX Whisper) is not yet decided.
