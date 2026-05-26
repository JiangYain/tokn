import type { CodexUsageEvent, CursorUsageEvent, DailyUsageRow, SummaryStats } from "./types.js";
import { addCodexDailyValues } from "./codex.js";
import { addCursorDailyValues } from "./cursor.js";
import { compareIsoDate, formatInt, formatUsd } from "./util.js";

export function buildDailyRows(
  from: string,
  to: string,
  codexEvents: CodexUsageEvent[],
  cursorEvents: CursorUsageEvent[],
): DailyUsageRow[] {
  const allDates = new Set<string>();
  allDates.add(from);
  allDates.add(to);
  for (const event of codexEvents) {
    allDates.add(event.localDate);
  }
  for (const event of cursorEvents) {
    allDates.add(event.localDate);
  }

  const rows = [...allDates]
    .filter((date) => compareIsoDate(date, from) >= 0 && compareIsoDate(date, to) <= 0)
    .sort(compareIsoDate)
    .map(createEmptyDailyRow);

  for (const row of rows) {
    addCodexDailyValues(row, codexEvents, row.date);
    addCursorDailyValues(row, cursorEvents, row.date);
    row.combinedTotalTokens = row.codexTotalTokens + row.cursorTotalTokens;
  }

  return rows;
}

function createEmptyDailyRow(date: string): DailyUsageRow {
  return {
    date,
    codexSessionCount: 0,
    codexInputTokens: 0,
    codexCachedInputTokens: 0,
    codexOutputTokens: 0,
    codexReasoningOutputTokens: 0,
    codexTotalTokens: 0,
    cursorRequestCount: 0,
    cursorInputTokens: 0,
    cursorCacheWriteTokens: 0,
    cursorCacheReadTokens: 0,
    cursorOutputTokens: 0,
    cursorTotalTokens: 0,
    cursorCostUsd: 0,
    codexEstimatedCostUsd: 0,
    cursorEstimatedCostUsd: 0,
    combinedEstimatedCostUsd: 0,
    combinedTotalTokens: 0,
  };
}

export function buildDailyCsvRows(rows: DailyUsageRow[]): Array<Record<string, string | number | null>> {
  return rows.map((row) => ({
    date: row.date,
    codex_session_count: row.codexSessionCount,
    codex_input_tokens: row.codexInputTokens,
    codex_cached_input_tokens: row.codexCachedInputTokens,
    codex_output_tokens: row.codexOutputTokens,
    codex_reasoning_output_tokens: row.codexReasoningOutputTokens,
    codex_total_tokens: row.codexTotalTokens,
    cursor_request_count: row.cursorRequestCount,
    cursor_input_tokens: row.cursorInputTokens,
    cursor_cache_write_tokens: row.cursorCacheWriteTokens,
    cursor_cache_read_tokens: row.cursorCacheReadTokens,
    cursor_output_tokens: row.cursorOutputTokens,
    cursor_total_tokens: row.cursorTotalTokens,
    cursor_cost_usd: row.cursorCostUsd,
    codex_estimated_cost_usd: row.codexEstimatedCostUsd,
    cursor_estimated_cost_usd: row.cursorEstimatedCostUsd,
    combined_estimated_cost_usd: row.combinedEstimatedCostUsd,
    combined_total_tokens: row.combinedTotalTokens,
  }));
}

export function summarizeRows(rows: DailyUsageRow[]): {
  combined: SummaryStats;
  codex: SummaryStats;
  cursor: SummaryStats;
} {
  return {
    combined: summarizeMetric(rows, (row) => row.combinedTotalTokens),
    codex: summarizeMetric(rows, (row) => row.codexTotalTokens),
    cursor: summarizeMetric(rows, (row) => row.cursorTotalTokens),
  };
}

function summarizeMetric(
  rows: DailyUsageRow[],
  selector: (row: DailyUsageRow) => number,
): SummaryStats {
  let totalTokens = 0;
  let activeDays = 0;
  let peakDay: DailyUsageRow | null = null;

  for (const row of rows) {
    const value = selector(row);
    totalTokens += value;
    if (value > 0) {
      activeDays += 1;
      if (!peakDay || value > selector(peakDay)) {
        peakDay = row;
      }
    }
  }

  return { activeDays, totalTokens, peakDay };
}

export function buildMarkdownReport(params: {
  from: string;
  to: string;
  timezone: string;
  rows: DailyUsageRow[];
}): string {
  const summary = summarizeRows(params.rows);
  const lines: string[] = [];

  lines.push("# Daily Token Usage Report");
  lines.push("");
  lines.push(`- Date range: ${params.from} .. ${params.to}`);
  lines.push(`- Timezone: ${params.timezone}`);
  lines.push(`- Combined total tokens: ${formatInt(summary.combined.totalTokens)}`);
  lines.push(`- Codex total tokens: ${formatInt(summary.codex.totalTokens)}`);
  lines.push(`- Cursor total tokens: ${formatInt(summary.cursor.totalTokens)}`);
  lines.push(`- Combined estimated cost: ${formatUsd(params.rows.reduce((sum, row) => sum + row.combinedEstimatedCostUsd, 0))}`);
  lines.push(`- Codex estimated cost: ${formatUsd(params.rows.reduce((sum, row) => sum + row.codexEstimatedCostUsd, 0))}`);
  lines.push(`- Cursor estimated cost: ${formatUsd(params.rows.reduce((sum, row) => sum + row.cursorEstimatedCostUsd, 0))}`);
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- Codex totals come from local `token_count` events in session JSONL files.");
  lines.push("- Cursor totals come from an undocumented dashboard CSV endpoint and may break if Cursor changes its web internals.");
  lines.push("- `combined_total_tokens` is a cross-tool high-level metric; provider subfields are kept separate because Codex and Cursor expose different token breakdowns.");
  lines.push("");
  lines.push("## Peaks");
  lines.push("");
  lines.push(formatPeakLine("Combined", summary.combined.peakDay, (row) => row.combinedTotalTokens));
  lines.push(formatPeakLine("Codex", summary.codex.peakDay, (row) => row.codexTotalTokens));
  lines.push(formatPeakLine("Cursor", summary.cursor.peakDay, (row) => row.cursorTotalTokens));
  lines.push("");
  lines.push("## Daily Table");
  lines.push("");
  lines.push("| Date | Codex Total | Cursor Total | Combined | Codex Sessions | Cursor Requests | Cursor Cost |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const row of params.rows) {
    lines.push(
      `| ${row.date} | ${formatInt(row.codexTotalTokens)} | ${formatInt(row.cursorTotalTokens)} | ${formatInt(row.combinedTotalTokens)} | ${formatInt(row.codexSessionCount)} | ${formatInt(row.cursorRequestCount)} | ${formatUsd(row.cursorCostUsd)} |`,
    );
  }

  return lines.join("\n");
}

function formatPeakLine(
  label: string,
  row: DailyUsageRow | null,
  selector: (row: DailyUsageRow) => number,
): string {
  if (!row) {
    return `- ${label}: none`;
  }
  return `- ${label}: ${row.date} with ${formatInt(selector(row))} tokens`;
}
