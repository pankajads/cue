import { contextBridge, ipcRenderer } from "electron";
import { IPC, SentimentAdvisorAPI } from "../shared/ipc-contract";

// Renderer runs with contextIsolation + nodeIntegration disabled (see
// main.ts) — this is the only bridge it gets to main-process capability,
// deliberately narrow rather than exposing ipcRenderer directly.
const api: SentimentAdvisorAPI = {
  getSystemAudioSourceId: () => ipcRenderer.invoke(IPC.getSystemAudioSourceId),
};

contextBridge.exposeInMainWorld("sentimentAdvisor", api);

declare global {
  interface Window {
    sentimentAdvisor: SentimentAdvisorAPI;
  }
}
