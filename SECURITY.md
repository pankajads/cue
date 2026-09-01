# Security Policy

## Supported versions

This project is pre-1.0 and under active development. Only the latest commit on `main` is supported — there are no maintained release branches yet.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities. Instead, email **pankajads@gmail.com** with:

- A description of the vulnerability and its potential impact.
- Steps to reproduce, or a proof of concept if you have one.
- The affected version/commit.

You should get an acknowledgment within a few days. There's no bug bounty program at this stage — this is a solo-maintained open-source project.

## What's in scope

- The Electron app itself (`src/`) — main process, preload bridge, renderer.
- The CI/release GitHub Actions workflows.
- Dependency vulnerabilities in `package.json`/`package-lock.json` (though `npm audit` already runs on every PR — check it isn't already known before reporting).

## Design context that's relevant to security review

- **Nothing leaves the machine.** Audio, transcripts, and conversation content are never sent to any server this project controls or any cloud API — the architectural threat model is different from a typical SaaS app; see [ARCHITECTURE.md](ARCHITECTURE.md).
- `contextIsolation` is on and `nodeIntegration` is off in the renderer; the only bridge to main-process capability is the narrow, typed API in `src/shared/ipc-contract.ts` — not raw `ipcRenderer`.
- The only network calls the app makes are the one-time, consent-gated model downloads (Whisper, the local LLM) from Hugging Face's CDN.
- `node-llama-cpp` (a native addon) is main-process-only by the library's own design; the renderer never has direct access to it.

If you find a way to reach the filesystem, the network, or main-process capability from the renderer outside of that narrow bridge, that's exactly the kind of report this policy is for.
