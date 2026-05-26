import { contextBridge, ipcRenderer } from "electron";
import type { AppDefaults, AppReportOptions, GenerateReportResult } from "../contracts.js";
import type { CursorAuth } from "../types.js";

contextBridge.exposeInMainWorld("tokenMonitor", {
  getDefaults: () => ipcRenderer.invoke("app:get-defaults") as Promise<AppDefaults>,
  pickDirectory: (currentPath?: string) =>
    ipcRenderer.invoke("app:pick-directory", currentPath) as Promise<string | null>,
  runReport: (options: AppReportOptions) =>
    ipcRenderer.invoke("report:run", options) as Promise<GenerateReportResult>,
  inspectCursorAuth: (options: AppReportOptions) =>
    ipcRenderer.invoke("cursor:inspect-auth", options) as Promise<CursorAuth>,
});
