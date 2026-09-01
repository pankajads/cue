import {
  ConversationGuidance,
  ConversationTurn,
  EMPTY_GUIDANCE,
  EMPTY_SIGNAL_SNAPSHOT,
  SentimentLabel,
  SignalSnapshot,
  SpeakerChannel,
  TensionTrend,
  TranscriptEvent,
} from "./types";
import { analyzeSignals } from "./signal-analyzer";
import { GuidanceAdvisor, priorityFor } from "./guidance-advisor";

export interface LlmAdvice {
  sentiment: SentimentLabel;
  tension: TensionTrend;
  guidance: string;
}

/**
 * The seam a future local-LLM upgrade plugs into. Planned implementation
 * (see ARCHITECTURE.md): `node-llama-cpp` running a small instruct model
 * in-process, grammar-constrained (GBNF) to this exact JSON shape so a small
 * model's output is reliably parseable, raced against a ~1.8s hard timeout
 * so it can only ever *upgrade* the guidance below, never block it.
 *
 * No concrete class implements this interface yet — until one is attached
 * via `ConversationSession.attachLlmEngine`, every session runs on the
 * instant rule-based path alone, which is a fully supported, permanent mode
 * (a user who never opts into the LLM download stays on this path forever).
 */
export interface LlmGuidanceEngine {
  advise(recentTurns: ConversationTurn[]): Promise<LlmAdvice>;
}

const MAX_TURNS = 30;

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Turns a stream of (possibly interim) transcript events into finalized
 * turns, and runs SignalAnalyzer + GuidanceAdvisor on every finalized turn
 * — the same instant, no-network guarantee regardless of whether an
 * LlmGuidanceEngine is attached. If one is attached, its result races the
 * rule-based read: a `generation` counter is bumped on every finalized
 * turn, and an in-flight LLM result is
 * only applied if that counter hasn't moved since the request started —
 * otherwise a slow response for an old turn could overwrite guidance for a
 * newer one. A failed or slow LLM call has no fallback behavior of its own
 * by design; the rule-based guidance already set is the whole guarantee.
 */
export class ConversationSession {
  private turns: ConversationTurn[] = [];
  private openTurns = new Map<SpeakerChannel, TranscriptEvent>();
  private guidanceAdvisor = new GuidanceAdvisor();
  private llmEngine: LlmGuidanceEngine | null = null;
  private generation = 0;

  signals: SignalSnapshot = EMPTY_SIGNAL_SNAPSHOT;
  guidance: ConversationGuidance = EMPTY_GUIDANCE;

  attachLlmEngine(engine: LlmGuidanceEngine): void {
    this.llmEngine = engine;
  }

  /**
   * Feeds one transcript event in. Returns the instant rule-based guidance
   * synchronously; if an LlmGuidanceEngine is attached, `onGuidanceUpdated`
   * (if given) is called again later with an upgraded result, provided no
   * newer turn or reset has happened in the meantime.
   */
  consume(event: TranscriptEvent, onGuidanceUpdated?: (guidance: ConversationGuidance) => void): ConversationGuidance {
    if (!event.isFinal) {
      this.openTurns.set(event.channel, event);
      return this.guidance;
    }

    const start = this.openTurns.get(event.channel)?.timestampMs ?? event.timestampMs;
    const turn: ConversationTurn = {
      text: event.text,
      channel: event.channel,
      startedAtMs: start,
      endedAtMs: event.timestampMs,
    };
    this.turns.push(turn);
    this.turns = this.turns.slice(-MAX_TURNS);
    this.openTurns.delete(event.channel);

    this.signals = analyzeSignals(this.turns);
    this.guidance = this.guidanceAdvisor.advise(this.signals);

    this.generation += 1;
    const requestGeneration = this.generation;
    const turnsSnapshot = this.turns.slice();
    const priorSeverity = this.guidance.turnsAtThisSeverity;
    const unansweredQuestion = this.signals.unansweredQuestion;

    if (this.llmEngine) {
      const engine = this.llmEngine;
      void engine
        .advise(turnsSnapshot)
        .then((advice) => {
          if (this.generation !== requestGeneration) return;
          const upgraded: ConversationGuidance = {
            headline: `${capitalize(advice.sentiment)} · ${capitalize(advice.tension)} tension`,
            suggestion: advice.guidance,
            priority: priorityFor(advice.sentiment, advice.tension, unansweredQuestion),
            turnsAtThisSeverity: priorSeverity,
            source: "llm",
          };
          this.guidance = upgraded;
          onGuidanceUpdated?.(upgraded);
        })
        .catch(() => {
          // No fallback here by design — see class doc comment.
        });
    }

    return this.guidance;
  }

  reset(): void {
    this.turns = [];
    this.openTurns.clear();
    this.signals = EMPTY_SIGNAL_SNAPSHOT;
    this.guidanceAdvisor.reset();
    this.guidance = EMPTY_GUIDANCE;
    this.generation += 1;
  }
}
