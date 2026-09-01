import {
  ConversationTurn,
  SentimentLabel,
  SignalSnapshot,
  TensionTrend,
  EMPTY_SIGNAL_SNAPSHOT,
  turnWordsPerMinute,
} from "./types";

// Deliberately a small, fixed lexicon rather than any ML model: instant,
// explainable, and needs no network call or bundled weights. `can't` and
// `cannot` are kept as separate literal tokens (not stemmed) to match how
// normalizedWords tokenizes contractions below.
const NEGATIVE_WORDS = new Set([
  "angry", "bad", "blame", "can't", "cannot", "disappointed", "fail", "failed",
  "failure", "issue", "never", "no", "problem", "wrong", "worried", "unacceptable",
]);
const POSITIVE_WORDS = new Set([
  "agree", "good", "great", "helpful", "perfect", "progress", "thanks", "thank", "yes",
]);
const QUESTION_WORDS = new Set(["can", "could", "how", "what", "when", "where", "why", "would"]);

function normalizedWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z']+/)
    .filter(Boolean);
}

function sentimentScore(turn: ConversationTurn): number {
  const words = normalizedWords(turn.text);
  const positive = words.filter((word) => POSITIVE_WORDS.has(word)).length;
  const negative = words.filter((word) => NEGATIVE_WORDS.has(word)).length;
  return positive - negative;
}

function containsQuestion(turn: ConversationTurn): boolean {
  const lowered = turn.text.toLowerCase();
  return lowered.includes("?") || normalizedWords(turn.text).some((word) => QUESTION_WORDS.has(word));
}

function countInterruptions(turns: ConversationTurn[]): number {
  let count = 0;
  for (let i = 0; i < turns.length - 1; i++) {
    const gapSeconds = (turns[i + 1].startedAtMs - turns[i].endedAtMs) / 1000;
    if (gapSeconds < 0.1) count++;
  }
  return count;
}

/**
 * Rule-based sentiment/tension read over the last few turns of a
 * conversation — no ML, no network call, instant: lexicon-scored sentiment
 * aggregated over a rolling window, a tension score combining that sentiment,
 * interruption rate, and speaking pace, plus a simple "is a question sitting
 * unanswered" check. See guidance-advisor.ts for how this turns into an
 * actual suggestion, and conversation-session.ts for how an optional
 * local-LLM upgrade layers on top without changing this contract.
 */
export function analyzeSignals(turns: ConversationTurn[]): SignalSnapshot {
  if (turns.length === 0) return EMPTY_SIGNAL_SNAPSHOT;

  const recent = turns.slice(-8);

  const wordsPerMinuteValues = recent.map(turnWordsPerMinute).filter((value) => value > 0);
  const averageWordsPerMinute =
    wordsPerMinuteValues.length === 0
      ? 0
      : wordsPerMinuteValues.reduce((a, b) => a + b, 0) / wordsPerMinuteValues.length;

  const pauses: number[] = [];
  for (let i = 0; i < recent.length - 1; i++) {
    pauses.push(Math.max(0, (recent[i + 1].startedAtMs - recent[i].endedAtMs) / 1000));
  }
  const averagePauseSeconds = pauses.length === 0 ? 0 : pauses.reduce((a, b) => a + b, 0) / pauses.length;

  const interruptionCount = countInterruptions(recent);
  const aggregateSentimentScore = recent.reduce((sum, turn) => sum + sentimentScore(turn), 0);

  let sentiment: SentimentLabel;
  if (aggregateSentimentScore > 1) sentiment = "positive";
  else if (aggregateSentimentScore < -1) sentiment = "negative";
  else sentiment = "neutral";

  const tensionScore =
    interruptionCount * 1.5 +
    (aggregateSentimentScore < 0 ? Math.abs(aggregateSentimentScore) : 0) +
    (averageWordsPerMinute > 190 ? 1 : 0) +
    (averagePauseSeconds < 0.25 && recent.length > 1 ? 0.5 : 0);

  const priorTension = recent.slice(0, -1).reduce((sum, turn) => sum + sentimentScore(turn), 0);

  let tension: TensionTrend;
  if (tensionScore >= 4) tension = "high";
  else if (tensionScore >= 2 && tensionScore > Math.abs(priorTension) + 0.5) tension = "rising";
  else if (tensionScore < 1) tension = "low";
  else tension = "stable";

  const last = recent[recent.length - 1];
  const secondLast = recent.length > 1 ? recent[recent.length - 2] : undefined;
  const hasQuestion = containsQuestion(last);
  const unansweredQuestion = hasQuestion && secondLast !== undefined && secondLast.channel === last.channel;

  const confidence = Math.min(0.95, 0.35 + Math.min(recent.length, 6) * 0.08);

  return {
    sentiment,
    tension,
    confidence,
    averageWordsPerMinute,
    averagePauseSeconds,
    interruptionCount,
    turnCount: turns.length,
    lastChannel: last.channel,
    unansweredQuestion,
  };
}
