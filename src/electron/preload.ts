import { contextBridge, ipcRenderer } from "electron";
import type { AppDefaults, AppReportOptions, GenerateReportResult, UsageLimitsSnapshot } from "../contracts.js";
import type { CursorAuth } from "../types.js";

contextBridge.exposeInMainWorld("tokenMonitor", {
  getDefaults: () => ipcRenderer.invoke("app:get-defaults") as Promise<AppDefaults>,
  launchLocal: (appId: string) => ipcRenderer.invoke("app:launch-local", appId) as Promise<void>,
  openExternal: (targetUrl: string) => ipcRenderer.invoke("app:open-external", targetUrl) as Promise<void>,
  pickDirectory: (currentPath?: string) =>
    ipcRenderer.invoke("app:pick-directory", currentPath) as Promise<string | null>,
  runReport: (options: AppReportOptions) =>
    ipcRenderer.invoke("report:run", options) as Promise<GenerateReportResult>,
  getUsageLimits: () => ipcRenderer.invoke("usage:get-limits") as Promise<UsageLimitsSnapshot>,
  inspectCursorAuth: (options: AppReportOptions) =>
    ipcRenderer.invoke("cursor:inspect-auth", options) as Promise<CursorAuth>,
});
