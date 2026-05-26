export interface RawUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface CodexUsageEvent extends RawUsage {
  source: "codex";
  sessionId: string;
  sessionPath: string;
  timestampMs: number;
  isoTimestamp: string;
  localDate: string;
  model: string | null;
}

export interface CursorUsageEvent {
  source: "cursor";
  requestId: string;
  timestampMs: number | null;
  isoTimestamp: string;
  localDate: string;
  model: string;
  kind: string;
  maxMode: string;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface DailyUsageRow {
  date: string;
  codexSessionCount: number;
  codexInputTokens: number;
  codexCachedInputTokens: number;
  codexOutputTokens: number;
  codexReasoningOutputTokens: number;
  codexTotalTokens: number;
  cursorRequestCount: number;
  cursorInputTokens: number;
  cursorCacheWriteTokens: number;
  cursorCacheReadTokens: number;
  cursorOutputTokens: number;
  cursorTotalTokens: number;
  cursorCostUsd: number;
  codexEstimatedCostUsd: number;
  cursorEstimatedCostUsd: number;
  combinedEstimatedCostUsd: number;
  combinedTotalTokens: number;
}

export interface CursorPaths {
  appDir: string;
  stateDbPath: string;
  cliConfigPath: string;
}

export interface CursorAuth {
  cookieHeader: string;
  userId: string | null;
  source: "local" | "env" | "cli";
  stateDbPath: string | null;
  cliConfigPath: string | null;
  expiresAtIso: string | null;
}

export interface ReportOptions {
  from: string;
  to: string;
  timezone: string;
  sources: Array<"codex" | "cursor">;
  outDir: string;
  codexRoot: string;
  cursorSessionToken?: string;
  cursorCookie?: string;
  cursorAppDir?: string;
  cursorCliConfigPath?: string;
}

export interface ParsedCliArgs {
  command: "report" | "cursor-auth" | "help";
  options: ReportOptions;
}

export interface SummaryStats {
  activeDays: number;
  totalTokens: number;
  peakDay: DailyUsageRow | null;
}
