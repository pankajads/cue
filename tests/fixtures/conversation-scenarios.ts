import { SpeakerChannel, TranscriptEvent } from "../../src/shared/guidance/types";

export interface ScenarioUtterance {
  channel: SpeakerChannel;
  text: string;
  startMs: number;
  endMs: number;
}

/** Expands one utterance into the interim-then-final TranscriptEvent pair a
 * streaming speech-to-text engine would actually emit, so turns get a real
 * start/end (and therefore a real words-per-minute/pause reading) instead of
 * a zero-duration final-only event. */
export function utteranceToEvents(utterance: ScenarioUtterance): TranscriptEvent[] {
  return [
    { text: utterance.text, channel: utterance.channel, isFinal: false, timestampMs: utterance.startMs },
    { text: utterance.text, channel: utterance.channel, isFinal: true, timestampMs: utterance.endMs },
  ];
}

/**
 * Scenario A: a customer-support engineer ("me") handling an increasingly
 * frustrated customer ("remote") about a stuck refund, who partially
 * de-escalates once they get a concrete commitment.
 */
export const SUPPORT_CALL_FRUSTRATED_CUSTOMER: ScenarioUtterance[] = [
  {
    channel: "remote",
    text: "I've been waiting two weeks for this refund and nobody has helped me, it's a real problem.",
    startMs: 0,
    endMs: 4200,
  },
  {
    channel: "me",
    text: "I'm sorry about that, can you give me your order number so I can look into it?",
    startMs: 4700,
    endMs: 8100,
  },
  {
    channel: "remote",
    text: "I already gave it twice and nothing happened, this is completely unacceptable.",
    startMs: 8500,
    endMs: 12000,
  },
  {
    channel: "me",
    text: "I understand, let me escalate this for you right now.",
    startMs: 12300,
    endMs: 14600,
  },
  {
    channel: "remote",
    text: "This keeps happening every time I call, I am extremely angry about this whole failure.",
    startMs: 14900,
    endMs: 19200,
  },
  {
    channel: "me",
    text: "You're right, I recognize this keeps happening and that's not okay, I'm issuing your refund immediately.",
    startMs: 19500,
    endMs: 24300,
  },
  {
    channel: "remote",
    text: "Okay, thank you, I appreciate you actually fixing it this time.",
    startMs: 24700,
    endMs: 27900,
  },
  {
    channel: "me",
    text: "Thank you for your patience, you'll see the refund within one business day.",
    startMs: 28200,
    endMs: 31800,
  },
];

/**
 * Scenario B: HR ("me") giving a site-reliability engineer ("remote")
 * constructive feedback, escalating to a formal written warning, about
 * rudeness to peers and repeated lateness.
 */
export const HR_WARNING_RUDE_LATE_ENGINEER: ScenarioUtterance[] = [
  {
    channel: "me",
    text: "I wanted to talk about two things today, your tone with teammates and your timekeeping.",
    startMs: 0,
    endMs: 4300,
  },
  {
    channel: "remote",
    text: "Okay, what's the problem exactly?",
    startMs: 4600,
    endMs: 6400,
  },
  {
    channel: "me",
    text: "Two peers reported you were rude and dismissive to them in stand-up this week, and that is unacceptable.",
    startMs: 6800,
    endMs: 11400,
  },
  {
    channel: "remote",
    text: "I disagree, I don't think I did anything wrong there.",
    startMs: 11700,
    endMs: 14200,
  },
  {
    channel: "me",
    text: "This is the third time we've discussed you being late to the office, and the rudeness on top of it is a real problem.",
    startMs: 14600,
    endMs: 19900,
  },
  {
    channel: "remote",
    text: "Fine, I hear you, I never meant to cause a problem for the team.",
    startMs: 20300,
    endMs: 23600,
  },
  {
    channel: "me",
    text: "I recognize this keeps happening, so this is now a formal written warning with a thirty day improvement plan.",
    startMs: 24000,
    endMs: 29500,
  },
  {
    channel: "remote",
    text: "Understood, I agree to be on time and to be more respectful going forward.",
    startMs: 29900,
    endMs: 33500,
  },
];
