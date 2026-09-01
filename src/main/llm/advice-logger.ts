import * as fs from "fs";
import * as path from "path";
import { ConversationTurn, LlmAdvice } from "../../shared/guidance";

export interface AdviceLogRecord {
  timestamp: string;
  /** The exact turns sent to the model — needed to judge whether `result`
   * (or `error`) was actually a good response to that input. */
  turns: ConversationTurn[];
  /** Wall-clock time for this advise() call, in ms — the same number that
   * matters against the ~1.8s race budget (see local-llm-engine.ts). */
  latencyMs: number;
  result: LlmAdvice | null;
  error: string | null;
}

export interface AdviceLogWriter {
  append(record: AdviceLogRecord): void;
}

/**
 * One JSON object per line (JSONL), appended to a plain file — not surfaced
 * anywhere in the UI. Meant for manually reviewing/comparing local-LLM
 * output quality over time: `tail -f` it during a call, or diff two runs
 * after changing the prompt, model, or quantization. Never fails the
 * request it's logging: a write failure here is swallowed (logged to
 * console) rather than thrown, since losing a diagnostic log line is a much
 * smaller problem than losing the actual guidance response over it.
 */
export class FileAdviceLogWriter implements AdviceLogWriter {
  constructor(private readonly filePath: string) {}

  append(record: AdviceLogRecord): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.appendFileSync(this.filePath, `${JSON.stringify(record)}\n`);
    } catch (error) {
      console.error("failed to write local-llm advice log", error);
    }
  }
}

export function buildLogRecord(
  turns: ConversationTurn[],
  startedAtMs: number,
  result: LlmAdvice | null,
  error: string | null
): AdviceLogRecord {
  return {
    timestamp: new Date().toISOString(),
    turns,
    latencyMs: Date.now() - startedAtMs,
    result,
    error,
  };
}
