import { ConversationTurn, LlmAdvice, SpeakerChannel } from "../../shared/guidance";

/** Official Qwen GGUF repo, Q4_K_M quantization (~490MB) — small enough for
 * "quick" local inference; grammar-constrained decoding (below) guarantees
 * syntactically valid JSON regardless of quantization level, so the main
 * quality tradeoff of a smaller/more-quantized model is wording nuance in
 * `guidance`, not structural reliability. */
const MODEL_URI = "hf:Qwen/Qwen2.5-0.5B-Instruct-GGUF:Q4_K_M";

/** Hard budget so a request can never hang past the product's latency
 * guarantee; leaves headroom under the ~2s target for the caller's own
 * dispatch/parse overhead on top of generation time. Matches the original
 * design's LLMGuidanceEngine.requestTimeout. */
const REQUEST_TIMEOUT_MS = 1_800;

/** Bounds worst-case generation time independent of the model's own
 * self-control over length — mentioned in the prompt too, since a model
 * that doesn't know the limit tends to ramble right up against it anyway. */
const MAX_GUIDANCE_CHARS = 140;

const ADVICE_SCHEMA = {
  type: "object",
  properties: {
    sentiment: { enum: ["positive", "neutral", "negative"] },
    tension: { enum: ["low", "rising", "high"] },
    guidance: { type: "string", maxLength: MAX_GUIDANCE_CHARS },
  },
} as const;

export interface GrammarHandle {
  parse(json: string): unknown;
}

export interface ChatSessionHandle {
  prompt(prompt: string, options: { grammar: GrammarHandle; maxTokens: number; signal?: AbortSignal }): Promise<string>;
}

export interface LlamaModelHandle {
  createContext(): Promise<{ getSequence(): unknown }>;
}

export interface LlamaHandle {
  loadModel(options: { modelPath: string }): Promise<LlamaModelHandle>;
  createGrammarForJsonSchema(schema: unknown): Promise<GrammarHandle>;
}

/**
 * The pieces of node-llama-cpp this engine depends on, narrowed to what it
 * actually calls — exists so the loading/prompting/timeout logic below can
 * be unit tested with fake deps, the same reason audio-sources.ts takes
 * injectable deps: node-llama-cpp's real bindings are a native addon that
 * loads an actual multi-hundred-MB model on disk, which has no place in a
 * fast unit test. See tests/reliability/local-llm-real.test.ts for the test
 * that exercises the real library end to end.
 */
export interface LocalLlmDeps {
  modelsDirectory: string;
  resolveModelFile(
    uri: string,
    directory: string,
    options: { verify: boolean; onProgress?: (status: { totalSize: number; downloadedSize: number }) => void }
  ): Promise<string>;
  getLlama(): Promise<LlamaHandle>;
  createChatSession(contextSequence: unknown): ChatSessionHandle;
}

function speakerLabel(channel: SpeakerChannel): string {
  return channel === "me" ? "Agent" : "Other party";
}

function buildPrompt(turns: ConversationTurn[]): string {
  const transcript = turns
    .slice(-6)
    .map((turn) => `${speakerLabel(turn.channel)}: ${turn.text}`)
    .join("\n");
  return [
    "You are a live call assistant helping the Agent. Read the conversation and",
    "judge the OTHER PARTY's sentiment and the overall tension, then give the",
    `Agent one short, concrete suggestion (max ${MAX_GUIDANCE_CHARS} characters) for`,
    "what to say or do next. Reply with only the JSON object the schema describes.",
    "",
    transcript,
  ].join("\n");
}

function isValidAdvice(value: unknown): value is LlmAdvice {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.sentiment === "positive" || candidate.sentiment === "neutral" || candidate.sentiment === "negative") &&
    (candidate.tension === "low" || candidate.tension === "rising" || candidate.tension === "high") &&
    typeof candidate.guidance === "string" &&
    candidate.guidance.trim().length > 0
  );
}

/**
 * Local-LLM guidance upgrade, running entirely in-process via node-llama-cpp
 * (llama.cpp bindings) — no external server, no network call once the model
 * is downloaded. This can only run in the main process: node-llama-cpp is a
 * native addon, and a sandboxed, nodeIntegration-off renderer has no way to
 * load one (see ARCHITECTURE.md). The renderer talks to this over IPC via
 * `LocalLlmGuidanceEngine` (src/renderer/local-llm-guidance-engine.ts).
 *
 * Deliberately has no fallback behavior of its own — same contract as the
 * original design's LLMGuidanceEngine. Callers (ConversationSession) must
 * always race this against the instant rule-based GuidanceAdvisor and
 * prefer whichever answers first / is available, so a slow or unavailable
 * model never leaves the UI without guidance.
 */
export class LocalLlmEngine {
  private readonly deps: LocalLlmDeps;
  private readonly requestTimeoutMs: number;
  private session: ChatSessionHandle | null = null;
  private grammar: GrammarHandle | null = null;
  private loadPromise: Promise<void> | null = null;

  constructor(deps: LocalLlmDeps, requestTimeoutMs: number = REQUEST_TIMEOUT_MS) {
    this.deps = deps;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  isReady(): boolean {
    return this.session !== null;
  }

  /** Idempotent — a second call while loading (or after loading) returns the
   * same promise rather than downloading/loading a second time. */
  enable(onProgress?: (fractionDone: number) => void): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.load(onProgress);
    }
    return this.loadPromise;
  }

  private async load(onProgress?: (fractionDone: number) => void): Promise<void> {
    const modelPath = await this.deps.resolveModelFile(MODEL_URI, this.deps.modelsDirectory, {
      verify: true,
      onProgress: onProgress
        ? (status) => {
            if (status.totalSize > 0) onProgress(status.downloadedSize / status.totalSize);
          }
        : undefined,
    });

    const llama = await this.deps.getLlama();
    const model = await llama.loadModel({ modelPath });
    const context = await model.createContext();
    this.grammar = await llama.createGrammarForJsonSchema(ADVICE_SCHEMA);
    this.session = this.deps.createChatSession(context.getSequence());
  }

  /**
   * Analyzes the last few turns and proposes sentiment/tension/guidance.
   * Throws if the model isn't loaded yet, or after ~1.8s regardless of
   * whether the model is still generating.
   */
  async advise(turns: ConversationTurn[]): Promise<LlmAdvice> {
    if (!this.session || !this.grammar) {
      throw new Error("LocalLlmEngine.advise called before enable() completed");
    }
    const grammar = this.grammar;
    const session = this.session;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const raw = await session.prompt(buildPrompt(turns), {
        grammar,
        maxTokens: 200,
        signal: controller.signal,
      });
      const parsed = grammar.parse(raw);
      if (!isValidAdvice(parsed)) {
        throw new Error(`local LLM returned an unexpected shape: ${raw}`);
      }
      return parsed;
    } finally {
      clearTimeout(timeout);
    }
  }
}

// node-llama-cpp is a pure-ESM package with top-level await in its own
// module graph. TypeScript's CommonJS output (this file compiles via plain
// tsc, not esbuild) down-levels a normal `await import(...)` into
// `Promise.resolve().then(() => require(...))` — which still calls
// `require()` synchronously under the hood and fails with
// ERR_REQUIRE_ASYNC_MODULE against a module that has top-level await.
// Routing the import through `new Function` hides the literal `import(...)`
// syntax from tsc's static rewrite, so this becomes a real, runtime-native
// dynamic import instead, which Node's ESM loader (used for `import()`
// regardless of the calling module's own format) handles correctly.
const importNodeLlamaCpp = new Function(
  "return import('node-llama-cpp')"
) as () => Promise<typeof import("node-llama-cpp")>;

/**
 * Wires the interface above to the real node-llama-cpp library. Kept as a
 * separate async factory rather than a default parameter so this file has
 * no top-level import of it — that alone loads the native addon, which unit
 * tests exercising LocalLlmEngine's own logic with fake deps should never
 * have to pay for (or have installed correctly) just to run.
 */
export async function createRealLocalLlmDeps(modelsDirectory: string): Promise<LocalLlmDeps> {
  const { getLlama, resolveModelFile, LlamaChatSession } = await importNodeLlamaCpp();
  return {
    modelsDirectory,
    resolveModelFile: (uri, directory, options) =>
      resolveModelFile(uri, { directory, verify: options.verify, onProgress: options.onProgress }),
    getLlama: () => getLlama() as unknown as Promise<LlamaHandle>,
    createChatSession: (contextSequence) =>
      new LlamaChatSession({ contextSequence: contextSequence as never }) as unknown as ChatSessionHandle,
  };
}
