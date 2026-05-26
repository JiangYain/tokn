/// <reference types="vite/client" />

import type { AppDefaults, AppReportOptions, GenerateReportResult } from "./contracts.js";
import type { CursorAuth } from "./types.js";

declare global {
  interface Window {
    tokenMonitor?: {
      getDefaults: () => Promise<AppDefaults>;
      pickDirectory: (currentPath?: string) => Promise<string | null>;
      runReport: (options: AppReportOptions) => Promise<GenerateReportResult>;
      inspectCursorAuth: (options: AppReportOptions) => Promise<CursorAuth>;
    };
  }
}

export {};
