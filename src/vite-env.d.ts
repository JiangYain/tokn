/// <reference types="vite/client" />

import type { AppDefaults, AppReportOptions, GenerateReportResult, UsageLimitsSnapshot } from "./contracts.js";
import type { CursorAuth } from "./types.js";

declare global {
  interface Window {
    tokenMonitor?: {
      getDefaults: () => Promise<AppDefaults>;
      launchLocal: (appId: string) => Promise<void>;
      openExternal: (targetUrl: string) => Promise<void>;
      pickDirectory: (currentPath?: string) => Promise<string | null>;
      runReport: (options: AppReportOptions) => Promise<GenerateReportResult>;
      getUsageLimits: () => Promise<UsageLimitsSnapshot>;
      inspectCursorAuth: (options: AppReportOptions) => Promise<CursorAuth>;
    };
  }
}

export {};
