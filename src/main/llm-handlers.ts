import { app, ipcMain } from "electron";
import * as path from "path";
import { IPC } from "../shared/ipc-contract";
import { createRealLocalLlmDeps, LocalLlmEngine } from "./llm/local-llm-engine";

// Created lazily on the first "enable" request, not at app startup — the
// whole point of consent-gating is that nothing downloads or loads until
// the user asks for it.
let engine: LocalLlmEngine | null = null;

async function getOrCreateEngine(): Promise<LocalLlmEngine> {
  if (!engine) {
    const modelsDirectory = path.join(app.getPath("userData"), "models");
    const deps = await createRealLocalLlmDeps(modelsDirectory);
    engine = new LocalLlmEngine(deps);
  }
  return engine;
}

export function registerLlmHandlers(): void {
  ipcMain.handle(IPC.llmEnable, async (event) => {
    const localLlmEngine = await getOrCreateEngine();
    await localLlmEngine.enable((fractionDone) => {
      event.sender.send(IPC.llmEnableProgress, fractionDone);
    });
  });

  ipcMain.handle(IPC.llmIsReady, () => engine?.isReady() ?? false);

  ipcMain.handle(IPC.llmAdvise, (_event, recentTurns) => {
    if (!engine || !engine.isReady()) {
      throw new Error("local LLM was not enabled/ready");
    }
    return engine.advise(recentTurns);
  });
}
