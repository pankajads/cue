import { ConversationGuidance, EMPTY_GUIDANCE, GuidancePriority, SentimentLabel, SignalSnapshot, TensionTrend } from "./types";

type Category =
  | "unansweredQuestion"
  | "negativeHigh"
  | "tensionHigh"
  | "negativeRising"
  | "negativeGeneral"
  | "calmPositive"
  | "steady";

function categoryFor(signals: SignalSnapshot): Category {
  if (signals.unansweredQuestion) return "unansweredQuestion";

  const { sentiment, tension } = signals;
  if (sentiment === "negative" && tension === "high") return "negativeHigh";
  if (tension === "high") return "tensionHigh";
  if (sentiment === "negative" && tension === "rising") return "negativeRising";
  if (sentiment === "negative") return "negativeGeneral";
  if (sentiment === "positive" && (tension === "low" || tension === "stable")) return "calmPositive";
  return "steady";
}

function guidanceFor(category: Category, streak: number): ConversationGuidance {
  switch (category) {
    case "unansweredQuestion":
      return {
        headline: "Question left hanging",
        suggestion:
          "They asked something and haven't gotten an answer yet — address it directly before moving on.",
        priority: "caution",
        turnsAtThisSeverity: streak,
        source: "rules",
      };

    case "negativeHigh": {
      let suggestion: string;
      if (streak === 1) {
        suggestion =
          'Acknowledge the frustration out loud before problem-solving: "I hear how frustrating this has been — let\'s fix it together." Slow down, and let them finish before responding.';
      } else if (streak <= 3) {
        suggestion = `Still critical after ${streak} turns — naming an apology again won't land twice. Name the pattern explicitly: "I recognize this keeps happening, and that's not okay." Offer one concrete next step with a timeframe.`;
      } else {
        suggestion = `This has stayed critical for ${streak} turns straight. Consider escalating for real: offer to loop in a manager, or give a firm written commitment, rather than repeating reassurance that isn't landing.`;
      }
      return {
        headline: streak === 1 ? "High tension, negative sentiment" : `Still high tension (turn ${streak} at this level)`,
        suggestion,
        priority: "urgent",
        turnsAtThisSeverity: streak,
        source: "rules",
      };
    }

    case "tensionHigh": {
      const suggestion =
        streak <= 1
          ? 'Slow the pace and check in explicitly: "Can I make sure I understand before we continue?" Avoid talking over them.'
          : `Tension has stayed high for ${streak} turns — consider a brief, explicit pause: "Let's take a breath and go one point at a time."`;
      return {
        headline: streak === 1 ? "Tension is high" : `Tension still high (turn ${streak})`,
        suggestion,
        priority: "urgent",
        turnsAtThisSeverity: streak,
        source: "rules",
      };
    }

    case "negativeRising": {
      const suggestion =
        streak <= 1
          ? 'Reflect their last point back before continuing: "So the issue is X — is that right?" That buys space before it escalates.'
          : `Tension has been rising for ${streak} turns without a clear acknowledgment — address it directly now, before it peaks rather than after.`;
      return {
        headline: "Tension is rising",
        suggestion,
        priority: "caution",
        turnsAtThisSeverity: streak,
        source: "rules",
      };
    }

    case "negativeGeneral": {
      const suggestion =
        streak <= 2
          ? "Lead with empathy, then ask one open question to understand the root cause rather than defending the outcome."
          : `This has stayed negative for ${streak} turns — the current approach may not be landing. Consider naming the tone directly and asking what would help most right now.`;
      return {
        headline: "Negative sentiment",
        suggestion,
        priority: "caution",
        turnsAtThisSeverity: streak,
        source: "rules",
      };
    }

    case "calmPositive":
      return {
        headline: "Calm and positive",
        suggestion: "Good moment to confirm next steps or ask for specific, actionable feedback while the tone is receptive.",
        priority: "info",
        turnsAtThisSeverity: streak,
        source: "rules",
      };

    case "steady":
      return {
        headline: "Steady conversation",
        suggestion: "Keep it moving with an open question to draw out more detail.",
        priority: "info",
        turnsAtThisSeverity: streak,
        source: "rules",
      };
  }
}

/**
 * Local, rule-based coaching layer on top of a SignalSnapshot. Deliberately
 * not an LLM: it maps the same signals already surfaced in the UI
 * (sentiment, tension, unanswered questions) to a short, concrete
 * suggestion — the instant guarantee that a local-LLM upgrade (see
 * conversation-session.ts) can only ever race against, never depend on.
 *
 * Stateful across calls: tracks how many consecutive turns the same
 * underlying situation has persisted and escalates its wording instead of
 * repeating the same suggestion every turn. Create one instance per
 * conversation session and let it live for the session's duration.
 */
export class GuidanceAdvisor {
  private lastCategory: Category | null = null;
  private streak = 0;

  advise(signals: SignalSnapshot): ConversationGuidance {
    if (signals.turnCount === 0) {
      this.lastCategory = null;
      this.streak = 0;
      return EMPTY_GUIDANCE;
    }

    const category = categoryFor(signals);
    if (category === this.lastCategory) {
      this.streak += 1;
    } else {
      this.streak = 1;
      this.lastCategory = category;
    }

    return guidanceFor(category, this.streak);
  }

  reset(): void {
    this.lastCategory = null;
    this.streak = 0;
  }
}

/** Same categorization used for the rule-based wording above, exposed so an
 * LLM-sourced result (which supplies its own suggestion text but not a
 * priority) can be classified consistently with the rest of the UI. */
export function priorityFor(
  sentiment: SentimentLabel,
  tension: TensionTrend,
  unansweredQuestion: boolean
): GuidancePriority {
  const category = categoryFor({
    sentiment,
    tension,
    confidence: 0,
    averageWordsPerMinute: 0,
    averagePauseSeconds: 0,
    interruptionCount: 0,
    turnCount: 1,
    lastChannel: null,
    unansweredQuestion,
  });
  switch (category) {
    case "unansweredQuestion":
    case "negativeRising":
    case "negativeGeneral":
      return "caution";
    case "negativeHigh":
    case "tensionHigh":
      return "urgent";
    case "calmPositive":
    case "steady":
      return "info";
  }
}
