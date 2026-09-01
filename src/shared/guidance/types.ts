// Shared types for the rule-based sentiment/guidance engine. Timestamps are
// plain epoch milliseconds (not Date objects) so this module has zero
// platform dependency and serializes cleanly across the renderer/test
// boundary — the same reason ipc-contract.ts stays a plain data shape.

export type SpeakerChannel = "me" | "remote" | "unknown";

/**
 * One chunk of speech-to-text output. `isFinal: false` is an interim
 * (still-being-recognized) update for a channel; `isFinal: true` closes it
 * out into a ConversationTurn. Mirrors how a streaming STT engine (e.g. the
 * planned whisper.cpp binding) naturally reports results.
 */
export interface TranscriptEvent {
  text: string;
  channel: SpeakerChannel;
  isFinal: boolean;
  timestampMs: number;
}

/** A finalized utterance from one speaker, with a real start/end so pace
 * (words per minute) and pauses/interruptions between turns are measurable. */
export interface ConversationTurn {
  text: string;
  channel: SpeakerChannel;
  startedAtMs: number;
  endedAtMs: number;
}

export function turnDurationSeconds(turn: ConversationTurn): number {
  return Math.max(0, (turn.endedAtMs - turn.startedAtMs) / 1000);
}

export function turnWordCount(turn: ConversationTurn): number {
  return turn.text.split(/\s+/).filter(Boolean).length;
}

export function turnWordsPerMinute(turn: ConversationTurn): number {
  const durationSeconds = turnDurationSeconds(turn);
  if (durationSeconds <= 0) return 0;
  return (turnWordCount(turn) / durationSeconds) * 60;
}

export type SentimentLabel = "positive" | "neutral" | "negative" | "unknown";
export type TensionTrend = "low" | "stable" | "rising" | "high" | "falling" | "unknown";

export interface SignalSnapshot {
  sentiment: SentimentLabel;
  tension: TensionTrend;
  confidence: number;
  averageWordsPerMinute: number;
  averagePauseSeconds: number;
  interruptionCount: number;
  turnCount: number;
  lastChannel: SpeakerChannel | null;
  unansweredQuestion: boolean;
}

export const EMPTY_SIGNAL_SNAPSHOT: SignalSnapshot = {
  sentiment: "unknown",
  tension: "unknown",
  confidence: 0,
  averageWordsPerMinute: 0,
  averagePauseSeconds: 0,
  interruptionCount: 0,
  turnCount: 0,
  lastChannel: null,
  unansweredQuestion: false,
};

export type GuidancePriority = "info" | "caution" | "urgent";

/** Where a suggestion came from — surfaced in the UI so the viewer always
 * knows whether they're looking at the instant rule-based read or a local-LLM
 * enriched one (see conversation-session.ts). */
export type GuidanceSource = "rules" | "llm";

export interface ConversationGuidance {
  headline: string;
  suggestion: string;
  priority: GuidancePriority;
  /** How many consecutive turns this same situation has held, including this
   * one. 1 means it just started; higher means it hasn't resolved yet. */
  turnsAtThisSeverity: number;
  source: GuidanceSource;
}

export const EMPTY_GUIDANCE: ConversationGuidance = {
  headline: "Gathering context",
  suggestion: "Keep the conversation going. Guidance appears once there are a few turns to read.",
  priority: "info",
  turnsAtThisSeverity: 0,
  source: "rules",
};
