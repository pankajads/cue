import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ChatSessionHandle,
  GrammarHandle,
  LlamaHandle,
  LocalLlmDeps,
  LocalLlmEngine,
} from "../../src/main/llm/local-llm-engine";
import { ConversationTurn } from "../../src/shared/guidance";

function turn(text: string, channel: ConversationTurn["channel"] = "remote"): ConversationTurn {
  return { text, channel, startedAtMs: 0, endedAtMs: 1000 };
}

function fakeGrammar(): GrammarHandle {
  return { parse: (json: string) => JSON.parse(json) };
}

/** A fake ChatSessionHandle whose prompt() properly honors the abort
 * signal — the same contract node-llama-cpp's real prompt() documents —
 * so timeout tests below exercise LocalLlmEngine's own timeout-wiring
 * logic without needing the real (multi-hundred-MB) model. */
function fakeSession(respond: (prompt: string) => string | "never"): ChatSessionHandle {
  return {
    prompt: (prompt, options) =>
      new Promise((resolve, reject) => {
        const result = respond(prompt);
        if (result === "never") {
          options.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          return;
        }
        resolve(result);
      }),
  };
}

function fakeDeps(overrides: Partial<LocalLlmDeps> = {}): LocalLlmDeps {
  return {
    modelsDirectory: "/fake/models",
    resolveModelFile: async () => "/fake/models/model.gguf",
    getLlama: async (): Promise<LlamaHandle> => ({
      loadModel: async () => ({ createContext: async () => ({ getSequence: () => "fake-sequence" }) }),
      createGrammarForJsonSchema: async () => fakeGrammar(),
    }),
    createChatSession: () => fakeSession(() => JSON.stringify({ sentiment: "negative", tension: "high", guidance: "Slow down." })),
    ...overrides,
  };
}

test("isReady is false until enable() resolves", async () => {
  const engine = new LocalLlmEngine(fakeDeps());
  assert.equal(engine.isReady(), false);
  await engine.enable();
  assert.equal(engine.isReady(), true);
});

test("enable() reports download progress and is idempotent", async () => {
  let resolveCallCount = 0;
  const deps = fakeDeps({
    resolveModelFile: async (_uri, _dir, options) => {
      resolveCallCount += 1;
      options.onProgress?.({ totalSize: 100, downloadedSize: 50 });
      options.onProgress?.({ totalSize: 100, downloadedSize: 100 });
      return "/fake/models/model.gguf";
    },
  });
  const engine = new LocalLlmEngine(deps);

  const progressReadings: number[] = [];
  await engine.enable((fractionDone) => progressReadings.push(fractionDone));
  await engine.enable((fractionDone) => progressReadings.push(fractionDone));

  assert.equal(resolveCallCount, 1, "expected the model to be resolved/downloaded only once across two enable() calls");
  assert.deepEqual(progressReadings, [0.5, 1]);
});

test("advise() throws if called before enable() completes", async () => {
  const engine = new LocalLlmEngine(fakeDeps());
  await assert.rejects(() => engine.advise([turn("hello")]));
});

test("advise() returns the parsed, grammar-constrained advice", async () => {
  const engine = new LocalLlmEngine(fakeDeps());
  await engine.enable();
  const advice = await engine.advise([turn("This is unacceptable.")]);
  assert.deepEqual(advice, { sentiment: "negative", tension: "high", guidance: "Slow down." });
});

test("advise() includes recent turns, labeled by speaker, in the prompt", async () => {
  let capturedPrompt = "";
  const deps = fakeDeps({
    createChatSession: () =>
      fakeSession((prompt) => {
        capturedPrompt = prompt;
        return JSON.stringify({ sentiment: "neutral", tension: "low", guidance: "Keep going." });
      }),
  });
  const engine = new LocalLlmEngine(deps);
  await engine.enable();
  await engine.advise([turn("I am upset about this.", "remote"), turn("I understand, let's fix it.", "me")]);

  assert.match(capturedPrompt, /Other party: I am upset about this\./);
  assert.match(capturedPrompt, /Agent: I understand, let's fix it\./);
});

test("advise() rejects if the model doesn't answer within the configured timeout", async () => {
  const deps = fakeDeps({ createChatSession: () => fakeSession(() => "never") });
  const engine = new LocalLlmEngine(deps, 50); // short timeout for a fast test
  await engine.enable();
  await assert.rejects(() => engine.advise([turn("hello")]));
});

test("advise() rejects if the model's output doesn't match the expected shape", async () => {
  const deps = fakeDeps({
    createChatSession: () => fakeSession(() => JSON.stringify({ sentiment: "not-a-real-value", tension: "high" })),
  });
  const engine = new LocalLlmEngine(deps);
  await engine.enable();
  await assert.rejects(() => engine.advise([turn("hello")]));
});
