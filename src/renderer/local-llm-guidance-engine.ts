import { ConversationTurn, LlmAdvice, LlmGuidanceEngine } from "../shared/guidance";

/**
 * Thin IPC proxy satisfying ConversationSession's LlmGuidanceEngine
 * interface. The actual model (node-llama-cpp) runs in the main process —
 * it's a native addon, and a sandboxed, nodeIntegration-off renderer can't
 * load one directly (see ARCHITECTURE.md). All the interesting logic
 * (loading, prompting, the ~1.8s timeout) lives in
 * src/main/llm/local-llm-engine.ts; this class only forwards the call.
 */
export class LocalLlmGuidanceEngine implements LlmGuidanceEngine {
  advise(recentTurns: ConversationTurn[]): Promise<LlmAdvice> {
    return window.sentimentAdvisor.adviseWithLocalLlm(recentTurns);
  }
}
