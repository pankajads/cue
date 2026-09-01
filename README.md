# Sentiment Advisor

**Real-time conversation coaching that never leaves your machine.**

[![CI](https://github.com/pankajads/sentiment-advisor-electron/actions/workflows/ci.yml/badge.svg)](https://github.com/pankajads/sentiment-advisor-electron/actions/workflows/ci.yml)
![platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-blue)
![privacy](https://img.shields.io/badge/audio%20%26%20transcripts-never%20leave%20the%20machine-brightgreen)
![tests](https://img.shields.io/badge/tests-44%20passing-brightgreen)

Sentiment Advisor sits quietly in your menu bar during a call. It listens, transcribes, and reads the tone of the conversation **as it happens** — then hands you a short, concrete suggestion for what to say next, right when it matters. Every part of that pipeline — audio, transcription, sentiment analysis — runs **entirely on your machine**. No audio, no transcript, no API call ever leaves it.

---

## The problem

Anyone on a live, high-stakes call is flying blind about their own delivery. A support agent can't tell in the moment whether the customer's frustration just tipped from "annoyed" to "about to escalate." An HR partner delivering a warning can't easily tell if their tone is landing as intended. A manager in a tense 1:1 is too busy thinking about what to say next to notice the pattern repeating for the third time.

The tools that exist today solve a different problem:
- **Post-call analytics** (Gong, Chorus, etc.) tell you how the call went — tomorrow, in a dashboard. Too late to change anything.
- **Cloud sentiment APIs** work live, but every word of the conversation leaves the building to get scored — a non-starter for HR conversations, healthcare, legal, or anything involving PII.
- **Manual self-awareness** is what everyone actually falls back on, which is exactly what's hardest to do while you're also listening, thinking, and talking.

## What Sentiment Advisor does about it

- **Listens locally** — your microphone, and separately, the other party's audio (system/"remote" audio, no separate call recording needed).
- **Transcribes locally** — OpenAI's Whisper model runs on-device (no cloud STT API).
- **Reads the tone as it happens** — a rule-based sentiment/tension engine scores every turn instantly (no network round-trip in the critical path), and escalates its language if a bad pattern persists instead of repeating the same tip forever.
- **Tells you what to actually do about it** — not just "sentiment: negative," but a concrete line to say or action to take, e.g. *"Still critical after 3 turns — naming an apology again won't land twice. Name the pattern explicitly and offer one concrete next step with a timeframe."*
- **Optionally upgrades that suggestion with a local LLM** — a small model (Qwen2.5-0.5B) running entirely on-device via `node-llama-cpp`, racing the instant rule-based read on every turn and only replacing it if it answers within ~1.8s (measured in practice: 380–750ms once warm). The instant path is never blocked waiting on it.
- **Never sends anything anywhere.** The privacy story isn't a policy promise, it's architectural: there's no server in this app to send data to.

## Who it's for

| Use case | What it catches |
|---|---|
| **Customer support** | A frustrated customer's tension climbing turn over turn, before it becomes an escalation you can't walk back |
| **HR / people ops** | Whether a difficult-feedback or warning conversation is landing as firm-but-professional, or just firm |
| **Sales** | Whether a prospect's engagement is genuinely warming up or you're talking past a stall |
| **1:1s and management** | A recurring issue (lateness, conflict with a peer) that keeps resurfacing without ever being named directly |

The two scenarios the guidance engine is validated against — end to end, algorithm and UI — are exactly the first two rows above; see [`tests/fixtures/conversation-scenarios.ts`](tests/fixtures/conversation-scenarios.ts) for the full transcripts.

## How it works

```mermaid
flowchart LR
    Mic["🎤 Microphone"] --> Capture
    Sys["🔊 System audio<br/>(the other party)"] --> Capture
    Capture["Local audio capture"] --> STT["Whisper<br/>(on-device, WASM)"]
    STT --> Engine["Sentiment + tension engine<br/>(instant, rule-based)"]
    Engine --> Panel["Guidance panel<br/>in the tray popover"]
    Engine -. optional, local .-> LLM["Local LLM upgrade<br/>(Qwen2.5-0.5B, node-llama-cpp)"]
    LLM -. richer phrasing, if it wins the ~1.8s race .-> Panel
```

Everything above — including the local LLM — exists and is tested today, not "planned." See [ARCHITECTURE.md](ARCHITECTURE.md) for the full, unvarnished technical design — including several real bugs real end-to-end tests caught that a code review never would have.

**Tech stack:**

| Layer | Choice | Why |
|---|---|---|
| Shell | Electron + TypeScript | One codebase, three OSes — the same reason `desktopCapturer` replaces a native virtual-audio-driver dependency |
| Speech-to-text | Whisper via [`@huggingface/transformers`](https://github.com/huggingface/transformers.js) (WASM, in-renderer) | No native addon, no per-platform binary matrix — see [ARCHITECTURE.md#speech-to-text](ARCHITECTURE.md#speech-to-text) |
| Local LLM (optional upgrade) | Qwen2.5-0.5B-Instruct via [`node-llama-cpp`](https://github.com/withcat-ai/node-llama-cpp) (main process) | The one piece that genuinely needs a native addon — runs in-process, no external server — see [ARCHITECTURE.md#local-llm-guidance-upgrade](ARCHITECTURE.md#local-llm-guidance-upgrade) |
| Sentiment/guidance | Hand-written TypeScript, zero dependencies | Instant, explainable, no ML latency in the critical path |
| Packaging | `electron-builder` | One config, native installers for all three OSes |

## Download & install

Prebuilt installers aren't published as a GitHub Release yet (this is an active, private project) — build one yourself, it takes under a minute:

```sh
git clone https://github.com/pankajads/sentiment-advisor-electron.git
cd sentiment-advisor-electron
npm install
npm run dist          # your current OS/arch only
# or target specific platforms:
npx electron-builder --mac --x64 --arm64
npx electron-builder --win --x64
npx electron-builder --linux --x64 --arm64
```

Installers land in `release/`: a `.dmg` for macOS, an `.exe` (NSIS) for Windows, an `.AppImage` for Linux — pick the one matching your OS and CPU architecture (Apple Silicon vs. Intel; most Windows/Linux machines are x64).

**These builds are unsigned** (no Apple Developer ID or Windows code-signing certificate yet), so the OS will warn you on first launch:
- **macOS**: Gatekeeper blocks it — right-click the app → **Open** (not double-click) the first time, or run `xattr -cr "/Applications/Sentiment Advisor.app"` if it still refuses.
- **Windows**: SmartScreen warns — click **More info** → **Run anyway**.

This is expected for an unsigned build, not a sign anything's wrong with the app itself.

## Using it

1. Launch the app — it lives in your tray/menu bar only (no Dock icon).
2. Click the tray icon to open the popover.
3. Click **Enable live transcription** (downloads the Whisper model once, ~150MB, cached after that).
4. Optionally, click **Enable local LLM guidance** (downloads Qwen2.5-0.5B once, ~490MB) for richer, model-generated suggestions racing the instant rule-based ones — entirely optional, the app is fully functional without it.
5. Click **Start listening**. Grant the microphone permission prompt (and screen-recording, for the system-audio side, on macOS).
6. Talk. Watch **Last heard** confirm what it transcribed, and the **Guidance** panel react to the tone of the conversation in real time — tagged `rules` or `llm` depending on which one answered.
7. Click **Stop listening** when you're done — it releases the microphone/screen-capture indicators immediately.

Both model downloads are the only network calls the app ever makes.

## Status

**End-to-end and test-covered**: 44 automated tests (unit/integration/e2e, `npm test`) plus two separate reliability tests that run the *real*, unstubbed Whisper and local-LLM pipelines against real inputs (`npm run test:reliability`) — no manual clicking required to verify any of it. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design and the real bugs found and fixed along the way (a renderer-crashing Electron API, a broken quantized model export, several CSP gaps, a TypeScript/CJS interop bug with ESM native modules, a stubbing gap that hid a crash from the test suite for a full round).

**Known open items:**
- System/"remote" audio capture works reliably on Windows; on macOS, Electron's own current API for it is documented as Windows-only, so it degrades gracefully to mic-only rather than crashing — see [ARCHITECTURE.md#audio-capture](ARCHITECTURE.md#audio-capture).
- No custom app icon yet (ships with Electron's default) and no code-signing certificate (see installer warnings above).

## Development

```sh
npm install
npm test            # build, then unit + integration + e2e (44 tests)
npm run dev          # run it locally
```

Tests are split into layers under `tests/`, each independently runnable:

| Layer | What it covers | Needs Electron? |
|---|---|---|
| `tests/unit/` | Pure logic: audio-source decisions, the sentiment/tension analyzer, the guidance advisor, session state, the utterance segmenter, the local-LLM engine (fake `node-llama-cpp`) — including the two full conversation-scenario fixtures | No — plain `node --test` |
| `tests/integration/` | The real app launching in a real Electron process, becoming ready, and quitting cleanly | Yes — spawns the built app |
| `tests/e2e/` | The real UI over Chromium's DevTools Protocol: Start/Stop listening, the conversation fixtures replayed through the actual guidance panel DOM, the full mic → segmenter → (fake) transcription → guidance pipeline, and a fake local-LLM engine proving the racing/upgrade DOM behavior | Yes — `playwright-core` drives the built app |
| `tests/reliability/` | The *real*, unstubbed Whisper and local-LLM pipelines against real synthesized speech / a real fixture transcript | Yes, plus network access (and macOS `say`/`afconvert` for the STT one) |

```sh
npm run test:unit
npm run test:integration
npm run test:e2e
npm run test:reliability   # separate from `npm test`/CI — see Status above
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the process layout, the guidance-engine design, and every real bug this project's own tests have caught (and how).
