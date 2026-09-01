# Contributing to Cue

## Workflow

Every change goes through a branch and a pull request — including from maintainers. `main` is protected: a PR can't merge until the `test` CI check passes.

```sh
git checkout -b your-branch-name
# make your change
npm test   # build, then unit + integration + e2e — see below
git push -u origin your-branch-name
gh pr create
```

Wait for CI to go green, then merge.

## Setup

```sh
npm install
npm run dev    # run it locally
```

## Testing

See [README.md#development](README.md#development) and [ARCHITECTURE.md](ARCHITECTURE.md) for the full layout. Short version:

```sh
npm test                    # unit + integration + e2e — required to pass before merge
npm run test:reliability    # real Whisper + real local-LLM pipelines, no fakes — not part of CI, run before touching either
```

If you change anything in `src/shared/guidance/`, `src/renderer/speech-to-text.ts`, or `src/main/llm/`, run the matching reliability test locally before opening a PR — the fast suite fakes both models to stay deterministic, so it can't catch a regression in the real pipeline.

## Code style

No linter is configured yet. Match the surrounding code: comment density, naming, and idiom in the file you're editing over any personal preference. Prefer dependency injection over ad-hoc mocking when adding logic that touches Electron, a native module, or the filesystem — see `src/main/audio-sources.ts` or `src/main/llm/local-llm-engine.ts` for the established pattern.

## Reporting bugs / requesting features

Open an issue using the provided templates. For anything security-related, see [SECURITY.md](SECURITY.md) instead of a public issue.
