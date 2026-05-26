import type { CursorAuth, DailyUsageRow, ReportOptions, SummaryStats } from "./types.js";

export interface AppDefaults {
  from: string;
  to: string;
  timezone: string;
  codexRoot: string;
  outDir: string;
  cursorAppDir: string;
  cursorCliConfigPath: string;
}

export interface ModelUsageEntry {
  model: string;
  totalTokens: number;
  costUsd: number;
}

export interface PricingSummary {
  mappingPath: string | null;
  mappedCodexEvents: number;
  unmappedCodexEvents: number;
  mappedCursorEvents: number;
  unmappedCursorEvents: number;
  codexEstimatedCostUsd: number;
  cursorEstimatedCostUsd: number;
  combinedEstimatedCostUsd: number;
  unresolvedObservedNames: string[];
}

export interface GenerateReportResult {
  outDir: string;
  files: {
    dailyCsvPath: string;
    dailyMarkdownPath: string;
    codexCsvPath: string;
    cursorCsvPath: string;
  };
  counts: {
    codexEvents: number;
    cursorEvents: number;
  };
  rows: DailyUsageRow[];
  summary: {
    combined: SummaryStats;
    codex: SummaryStats;
    cursor: SummaryStats;
  };
  modelUsage: ModelUsageEntry[];
  cursorAuth: CursorAuth | null;
  pricingSummary: PricingSummary;
}

export type AppReportOptions = ReportOptions;
