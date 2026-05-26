import fs from "node:fs/promises";
import path from "node:path";
import { loadCodexEvents, codexEventRowsForCsv } from "./codex.js";
import { loadCursorEvents } from "./cursor.js";
import { computeEstimatedPricing } from "./pricing.js";
import { buildDailyCsvRows, buildDailyRows, buildMarkdownReport, summarizeRows } from "./report.js";
import type { GenerateReportResult, ModelUsageEntry, PricingSummary } from "./contracts.js";
import type { CodexUsageEvent, CursorUsageEvent, ReportOptions } from "./types.js";
import { ensureDir, oneYearAgoInZone, resolveDefaultCodexRoot, todayInZone, toCsv } from "./util.js";
import { resolveCursorPaths, resolveCursorAuth } from "./cursor.js";

function aggregateModelUsage(
  codexEvents: CodexUsageEvent[],
  cursorEvents: CursorUsageEvent[],
  codexCostByModel: Map<string, number>,
  cursorCostByModel: Map<string, number>,
): ModelUsageEntry[] {
  const map = new Map<string, { totalTokens: number; costUsd: number }>();
  for (const e of codexEvents) {
    const key = e.model ?? "unknown";
    const entry = map.get(key) ?? { totalTokens: 0, costUsd: 0 };
    entry.totalTokens += e.totalTokens;
    map.set(key, entry);
  }
  for (const e of cursorEvents) {
    const key = e.model || "unknown";
    const entry = map.get(key) ?? { totalTokens: 0, costUsd: 0 };
    entry.totalTokens += e.totalTokens;
    map.set(key, entry);
  }

  for (const [key, entry] of map.entries()) {
    entry.costUsd = (codexCostByModel.get(key) ?? 0) + (cursorCostByModel.get(key) ?? 0);
    map.set(key, entry);
  }

  return Array.from(map.entries())
    .map(([model, v]) => ({ model, totalTokens: v.totalTokens, costUsd: v.costUsd }))
    .sort((a, b) => b.totalTokens - a.totalTokens);
}

export async function generateReport(options: ReportOptions): Promise<GenerateReportResult> {
  const codexEvents = options.sources.includes("codex")
    ? await loadCodexEvents({
        codexRoot: options.codexRoot,
        timezone: options.timezone,
        from: options.from,
        to: options.to,
      })
    : [];

  const cursorLoad = options.sources.includes("cursor")
    ? await loadCursorEvents({
        timezone: options.timezone,
        from: options.from,
        to: options.to,
        sessionToken: options.cursorSessionToken,
        cookieHeader: options.cursorCookie,
        cursorAppDir: options.cursorAppDir,
        cursorCliConfigPath: options.cursorCliConfigPath,
      })
    : { auth: null, events: [] };

  const pricing = await computeEstimatedPricing(codexEvents, cursorLoad.events);
  const rows = buildDailyRows(options.from, options.to, codexEvents, cursorLoad.events);
  applyEstimatedCosts(rows, pricing.codexByDate, pricing.cursorByDate);
  const summary = summarizeRows(rows);
  const modelUsage = aggregateModelUsage(
    codexEvents,
    cursorLoad.events,
    pricing.codexByModel,
    pricing.cursorByModel,
  );
  const markdown = buildMarkdownReport({
    from: options.from,
    to: options.to,
    timezone: options.timezone,
    rows,
  });

  await ensureDir(options.outDir);
  const suffix = `${options.from}__${options.to}`;
  const files = {
    dailyCsvPath: path.join(options.outDir, `daily-usage-${suffix}.csv`),
    dailyMarkdownPath: path.join(options.outDir, `daily-usage-${suffix}.md`),
    codexCsvPath: path.join(options.outDir, `codex-events-${suffix}.csv`),
    cursorCsvPath: path.join(options.outDir, `cursor-events-${suffix}.csv`),
  };

  await fs.writeFile(
    files.dailyCsvPath,
    toCsv(buildDailyCsvRows(rows), [
      "date",
      "codex_session_count",
      "codex_input_tokens",
      "codex_cached_input_tokens",
      "codex_output_tokens",
      "codex_reasoning_output_tokens",
      "codex_total_tokens",
      "cursor_request_count",
      "cursor_input_tokens",
      "cursor_cache_write_tokens",
      "cursor_cache_read_tokens",
      "cursor_output_tokens",
      "cursor_total_tokens",
      "cursor_cost_usd",
      "codex_estimated_cost_usd",
      "cursor_estimated_cost_usd",
      "combined_estimated_cost_usd",
      "combined_total_tokens",
    ]),
    "utf8",
  );

  await fs.writeFile(files.dailyMarkdownPath, markdown, "utf8");
  await fs.writeFile(
    files.codexCsvPath,
    toCsv(codexEventRowsForCsv(codexEvents), [
      "source",
      "local_date",
      "iso_timestamp",
      "session_id",
      "model",
      "input_tokens",
      "cached_input_tokens",
      "output_tokens",
      "reasoning_output_tokens",
      "total_tokens",
      "session_path",
    ]),
    "utf8",
  );
  await fs.writeFile(
    files.cursorCsvPath,
    toCsv(
      cursorLoad.events.map((event) => ({
        source: event.source,
        local_date: event.localDate,
        iso_timestamp: event.isoTimestamp,
        request_id: event.requestId,
        model: event.model,
        kind: event.kind,
        max_mode: event.maxMode,
        input_tokens: event.inputTokens,
        cache_write_tokens: event.cacheWriteTokens,
        cache_read_tokens: event.cacheReadTokens,
        output_tokens: event.outputTokens,
        total_tokens: event.totalTokens,
        cost_usd: event.costUsd,
      })),
      [
        "source",
        "local_date",
        "iso_timestamp",
        "request_id",
        "model",
        "kind",
        "max_mode",
        "input_tokens",
        "cache_write_tokens",
        "cache_read_tokens",
        "output_tokens",
        "total_tokens",
        "cost_usd",
      ],
    ),
    "utf8",
  );

  return {
    outDir: options.outDir,
    files,
    counts: {
      codexEvents: codexEvents.length,
      cursorEvents: cursorLoad.events.length,
    },
    rows,
    summary,
    modelUsage,
    cursorAuth: cursorLoad.auth,
    pricingSummary: pricing.summary,
  };
}

function applyEstimatedCosts(
  rows: GenerateReportResult["rows"],
  codexByDate: Map<string, number>,
  cursorByDate: Map<string, number>,
): void {
  for (const row of rows) {
    row.codexEstimatedCostUsd = codexByDate.get(row.date) ?? 0;
    row.cursorEstimatedCostUsd = cursorByDate.get(row.date) ?? 0;
    row.combinedEstimatedCostUsd = row.codexEstimatedCostUsd + row.cursorEstimatedCostUsd;
  }
}

export function getAppDefaults(timezone: string) {
  const today = todayInZone(timezone);
  const cursorPaths = resolveCursorPaths();
  return {
    from: oneYearAgoInZone(timezone),
    to: today,
    timezone,
    codexRoot: resolveDefaultCodexRoot(),
    outDir: path.join(process.cwd(), "reports", today),
    cursorAppDir: cursorPaths.appDir,
    cursorCliConfigPath: cursorPaths.cliConfigPath,
  };
}

export function inspectCursorAuth(options: ReportOptions) {
  return resolveCursorAuth({
    timezone: options.timezone,
    from: options.from,
    to: options.to,
    sessionToken: options.cursorSessionToken,
    cookieHeader: options.cursorCookie,
    cursorAppDir: options.cursorAppDir,
    cursorCliConfigPath: options.cursorCliConfigPath,
  });
}
