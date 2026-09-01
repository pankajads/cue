import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildLogRecord, FileAdviceLogWriter } from "../../src/main/llm/advice-logger";
import { ConversationTurn } from "../../src/shared/guidance";

function turn(text: string): ConversationTurn {
  return { text, channel: "remote", startedAtMs: 0, endedAtMs: 1000 };
}

test("buildLogRecord captures the turns, latency, result, and a timestamp", () => {
  const startedAtMs = Date.now() - 250;
  const record = buildLogRecord([turn("hello")], startedAtMs, { sentiment: "neutral", tension: "low", guidance: "ok" }, null);

  assert.deepEqual(record.turns, [turn("hello")]);
  assert.deepEqual(record.result, { sentiment: "neutral", tension: "low", guidance: "ok" });
  assert.equal(record.error, null);
  assert.ok(record.latencyMs >= 250, `expected latencyMs to reflect elapsed time, got ${record.latencyMs}`);
  assert.ok(!Number.isNaN(Date.parse(record.timestamp)), "expected a valid ISO timestamp");
});

test("buildLogRecord records an error instead of a result on failure", () => {
  const record = buildLogRecord([turn("hello")], Date.now(), null, "timed out");
  assert.equal(record.result, null);
  assert.equal(record.error, "timed out");
});

test("FileAdviceLogWriter appends one JSON object per line, creating the directory if needed", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "advice-logger-test-"));
  const filePath = path.join(dir, "nested", "advice.jsonl");
  const writer = new FileAdviceLogWriter(filePath);

  const first = buildLogRecord([turn("first")], Date.now(), { sentiment: "positive", tension: "low", guidance: "good" }, null);
  const second = buildLogRecord([turn("second")], Date.now(), null, "some error");
  writer.append(first);
  writer.append(second);

  const lines = fs.readFileSync(filePath, "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]), first);
  assert.deepEqual(JSON.parse(lines[1]), second);
});

test("FileAdviceLogWriter swallows write failures rather than throwing", () => {
  // A null byte makes Node reject the path outright (ERR_INVALID_ARG_VALUE)
  // on every platform, guaranteeing the write fails -- append() must not
  // throw regardless, since losing a diagnostic log line should never take
  // down the actual guidance response it is logging.
  const writer = new FileAdviceLogWriter(os.tmpdir() + "/invalid\0path/advice.jsonl");
  assert.doesNotThrow(() => writer.append(buildLogRecord([turn("x")], Date.now(), null, "irrelevant")));
});
