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

export interface UsageLimitWindow {
  usedPercent: number;
  resetAt: string | number | null;
  limitWindowSeconds?: number | null;
}

export interface CodexUsageLimits {
  configured: boolean;
  error: string | null;
  planType: string | null;
  primaryWindow: UsageLimitWindow | null;
  secondaryWindow: UsageLimitWindow | null;
}

export interface CursorUsageLimits {
  configured: boolean;
  error: string | null;
  membershipType: string | null;
  primaryWindow: UsageLimitWindow | null;
  secondaryWindow: UsageLimitWindow | null;
  tertiaryWindow: UsageLimitWindow | null;
  requestLimit: number | null;
  rawPlanUsed: number | null;
  rawPlanLimit: number | null;
  rawPlanRemaining: number | null;
}

export interface UsageLimitsSnapshot {
  fetchedAt: string;
  codex: CodexUsageLimits;
  cursor: CursorUsageLimits;
}

export interface GenerateReportResult {
  warnings: ReportWarning[];
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

export interface ReportWarning {
  source: "codex" | "cursor";
  message: string;
}

export type AppReportOptions = ReportOptions;
