import type { AppDefaults, AppReportOptions, GenerateReportResult, ModelUsageEntry } from "../contracts.js";
import type { CursorAuth, DailyUsageRow } from "../types.js";

export interface TokenMonitorBridge {
  mode: "desktop" | "web" | "preview";
  getDefaults: () => Promise<AppDefaults>;
  pickDirectory: (currentPath?: string) => Promise<string | null>;
  runReport: (options: AppReportOptions) => Promise<GenerateReportResult>;
  inspectCursorAuth: (options: AppReportOptions) => Promise<CursorAuth>;
}

export function getTokenMonitorBridge(): TokenMonitorBridge {
  if (typeof window !== "undefined" && window.tokenMonitor) {
    return {
      mode: "desktop",
      ...window.tokenMonitor,
    };
  }

  if (typeof window !== "undefined" && /^https?:$/.test(window.location.protocol)) {
    return createWebBridge();
  }

  return createPreviewBridge();
}

function createWebBridge(): TokenMonitorBridge {
  return {
    mode: "web",
    async getDefaults() {
      return fetchJson<AppDefaults>("/__token-monitor/defaults", {
        method: "GET",
      });
    },
    async pickDirectory(currentPath) {
      const response = await fetch("/__token-monitor/pick-directory", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ currentPath }),
      });
      if (!response.ok) {
        return null;
      }
      return (await response.json()) as string | null;
    },
    async runReport(options) {
      return fetchJson<GenerateReportResult>("/__token-monitor/report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(options),
      });
    },
    async inspectCursorAuth(options) {
      return fetchJson<CursorAuth>("/__token-monitor/cursor-auth", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(options),
      });
    },
  };
}

function createPreviewBridge(): TokenMonitorBridge {
  return {
    mode: "preview",
    async getDefaults() {
      const today = new Date();
      const from = new Date(today);
      from.setFullYear(today.getFullYear() - 1);
      return {
        from: toIsoDate(from),
        to: toIsoDate(today),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        codexRoot: "C:\\Users\\you\\.codex",
        outDir: "C:\\Users\\you\\Documents\\DailyTokenReports",
        cursorAppDir: "C:\\Users\\you\\AppData\\Roaming\\Cursor",
        cursorCliConfigPath: "C:\\Users\\you\\.cursor\\cli-config.json",
      };
    },
    async pickDirectory(currentPath) {
      return currentPath ?? null;
    },
    async runReport(options) {
      return buildPreviewReport(options);
    },
    async inspectCursorAuth() {
      return {
        cookieHeader: "WorkosCursorSessionToken=preview-mode",
        userId: "preview-user",
        source: "cli",
        stateDbPath: null,
        cliConfigPath: null,
        expiresAtIso: null,
      };
    },
  };
}

function buildPreviewReport(options: AppReportOptions): GenerateReportResult {
  const rows = buildPreviewRows(options.from, options.to);
  const summary = {
    combined: summarize(rows, "combined"),
    codex: summarize(rows, "codex"),
    cursor: summarize(rows, "cursor"),
  };

  const modelUsage: ModelUsageEntry[] = [
    { model: "claude-sonnet-4-20250514", totalTokens: 68_400_000, costUsd: 1.82 },
    { model: "gpt-4.1", totalTokens: 42_100_000, costUsd: 0.95 },
    { model: "o3", totalTokens: 31_200_000, costUsd: 0.64 },
    { model: "claude-3.5-sonnet", totalTokens: 18_900_000, costUsd: 0.41 },
    { model: "gemini-2.5-pro", totalTokens: 8_600_000, costUsd: 0.12 },
  ];

  return {
    outDir: `${options.outDir}\\preview-mode`,
    files: {
      dailyCsvPath: `${options.outDir}\\preview-daily-usage.csv`,
      dailyMarkdownPath: `${options.outDir}\\preview-daily-usage.md`,
      codexCsvPath: `${options.outDir}\\preview-codex-events.csv`,
      cursorCsvPath: `${options.outDir}\\preview-cursor-events.csv`,
    },
    counts: {
      codexEvents: 218,
      cursorEvents: 41,
    },
    rows,
    summary,
    modelUsage,
    cursorAuth: {
      cookieHeader: "WorkosCursorSessionToken=preview-mode",
      userId: "preview-user",
      source: "cli",
      stateDbPath: null,
      cliConfigPath: null,
      expiresAtIso: null,
    },
    pricingSummary: {
      mappingPath: "preview-mode",
      mappedCodexEvents: 218,
      unmappedCodexEvents: 0,
      mappedCursorEvents: 41,
      unmappedCursorEvents: 0,
      codexEstimatedCostUsd: rows.reduce((sum, row) => sum + row.codexEstimatedCostUsd, 0),
      cursorEstimatedCostUsd: rows.reduce((sum, row) => sum + row.cursorEstimatedCostUsd, 0),
      combinedEstimatedCostUsd: rows.reduce((sum, row) => sum + row.combinedEstimatedCostUsd, 0),
      unresolvedObservedNames: [],
    },
  };
}

function buildPreviewRows(from: string, to: string): DailyUsageRow[] {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  const dayMs = 24 * 60 * 60 * 1000;
  const results: DailyUsageRow[] = [];

  const shapes = [
    { codex: 18_420_000, cursor: 9_240_000, sessions: 4, requests: 6, cost: 0.32 },
    { codex: 42_880_000, cursor: 31_600_000, sessions: 6, requests: 9, cost: 0.64 },
    { codex: 0, cursor: 0, sessions: 0, requests: 0, cost: 0 },
    { codex: 24_360_000, cursor: 54_120_000, sessions: 3, requests: 12, cost: 0.98 },
    { codex: 63_540_000, cursor: 12_820_000, sessions: 7, requests: 4, cost: 0.22 },
    { codex: 36_110_000, cursor: 26_730_000, sessions: 5, requests: 8, cost: 0.51 },
    { codex: 0, cursor: 0, sessions: 0, requests: 0, cost: 0 },
    { codex: 11_200_000, cursor: 8_100_000, sessions: 2, requests: 3, cost: 0.14 },
    { codex: 55_000_000, cursor: 41_200_000, sessions: 8, requests: 11, cost: 0.88 },
    { codex: 29_800_000, cursor: 19_500_000, sessions: 4, requests: 7, cost: 0.42 },
  ];

  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + dayMs)) {
    const date = toIsoDate(d);
    const idx = Math.floor((d.getTime() - start.getTime()) / dayMs);
    const shape = shapes[idx % shapes.length]!;

    const codexInput = Math.round(shape.codex * 0.962);
    const codexCached = Math.round(codexInput * 0.89);
    const codexOutput = Math.round(shape.codex * 0.011);
    const codexReasoning = Math.round(shape.codex * 0.004);
    const cursorInput = Math.round(shape.cursor * 0.02);
    const cursorCacheWrite = Math.round(shape.cursor * 0.06);
    const cursorCacheRead = Math.round(shape.cursor * 0.89);
    const cursorOutput = Math.round(shape.cursor * 0.03);

    results.push({
      date,
      codexSessionCount: shape.sessions,
      codexInputTokens: codexInput,
      codexCachedInputTokens: codexCached,
      codexOutputTokens: codexOutput,
      codexReasoningOutputTokens: codexReasoning,
      codexTotalTokens: shape.codex,
      cursorRequestCount: shape.requests,
      cursorInputTokens: cursorInput,
      cursorCacheWriteTokens: cursorCacheWrite,
      cursorCacheReadTokens: cursorCacheRead,
      cursorOutputTokens: cursorOutput,
      cursorTotalTokens: shape.cursor,
      cursorCostUsd: shape.cost,
      codexEstimatedCostUsd: shape.codex / 1_000_000 * 1.25,
      cursorEstimatedCostUsd: shape.cost,
      combinedEstimatedCostUsd: shape.codex / 1_000_000 * 1.25 + shape.cost,
      combinedTotalTokens: shape.codex + shape.cursor,
    });
  }

  return results;
}

function summarize(rows: DailyUsageRow[], type: "combined" | "codex" | "cursor") {
  let totalTokens = 0;
  let activeDays = 0;
  let peakDay: DailyUsageRow | null = null;

  for (const row of rows) {
    const value =
      type === "combined" ? row.combinedTotalTokens
        : type === "codex" ? row.codexTotalTokens
          : row.cursorTotalTokens;

    totalTokens += value;
    if (value > 0) {
      activeDays += 1;
      if (!peakDay) { peakDay = row; continue; }
      const currentPeak =
        type === "combined" ? peakDay.combinedTotalTokens
          : type === "codex" ? peakDay.codexTotalTokens
            : peakDay.cursorTotalTokens;
      if (value > currentPeak) peakDay = row;
    }
  }

  return { activeDays, totalTokens, peakDay };
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data?.error) {
        message = data.error;
      }
    } catch {
      // Ignore parse failures and keep the HTTP status text.
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}
