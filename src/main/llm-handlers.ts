import { app, ipcMain } from "electron";
import * as path from "path";
import { IPC } from "../shared/ipc-contract";
import { createRealLocalLlmDeps, LocalLlmEngine } from "./llm/local-llm-engine";
import { buildLogRecord, FileAdviceLogWriter } from "./llm/advice-logger";

// Created lazily on the first "enable" request, not at app startup — the
// whole point of consent-gating is that nothing downloads or loads until
// the user asks for it.
let engine: LocalLlmEngine | null = null;
let logWriter: FileAdviceLogWriter | null = null;

async function getOrCreateEngine(): Promise<LocalLlmEngine> {
  if (!engine) {
    const modelsDirectory = path.join(app.getPath("userData"), "models");
    const deps = await createRealLocalLlmDeps(modelsDirectory);
    engine = new LocalLlmEngine(deps);
  }
  return engine;
}

function getLogWriter(): FileAdviceLogWriter {
  if (!logWriter) {
    logWriter = new FileAdviceLogWriter(path.join(app.getPath("userData"), "logs", "local-llm-advice.jsonl"));
  }
  return logWriter;
}

export function registerLlmHandlers(): void {
  ipcMain.handle(IPC.llmEnable, async (event) => {
    const localLlmEngine = await getOrCreateEngine();
    await localLlmEngine.enable((fractionDone) => {
      event.sender.send(IPC.llmEnableProgress, fractionDone);
    });
  });

  ipcMain.handle(IPC.llmIsReady, () => engine?.isReady() ?? false);

  ipcMain.handle(IPC.llmAdvise, async (_event, recentTurns) => {
    if (!engine || !engine.isReady()) {
      throw new Error("local LLM was not enabled/ready");
    }
    // Every call is logged — success or failure — to a plain JSONL file
    // (see advice-logger.ts) so response quality/latency can be reviewed
    // and compared over time; not surfaced anywhere in the UI.
    const startedAtMs = Date.now();
    try {
      const advice = await engine.advise(recentTurns);
      getLogWriter().append(buildLogRecord(recentTurns, startedAtMs, advice, null));
      return advice;
    } catch (error) {
      getLogWriter().append(buildLogRecord(recentTurns, startedAtMs, null, (error as Error).message));
      throw error;
    }
  });
}
