import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { DateTime } from "luxon";
import type { CodexUsageEvent, DailyUsageRow, RawUsage } from "./types.js";
import { isDateInRange, parseInteger } from "./util.js";

interface CodexParseOptions {
  codexRoot: string;
  timezone: string;
  from: string;
  to: string;
}

interface CodexLogPayload {
  type?: string;
  model?: string;
  info?: {
    model?: string;
    last_token_usage?: Record<string, unknown>;
    total_token_usage?: Record<string, unknown>;
  };
}

interface CodexLogEntry {
  timestamp?: string;
  type?: string;
  payload?: CodexLogPayload & { model?: string };
}

export async function loadCodexEvents(options: CodexParseOptions): Promise<CodexUsageEvent[]> {
  const sessionsDir = path.join(options.codexRoot, "sessions");
  const files = await collectJsonlFiles(sessionsDir);
  const events: CodexUsageEvent[] = [];

  for (const filePath of files) {
    const fileEvents = await parseCodexSessionFile(filePath, sessionsDir, options);
    events.push(...fileEvents);
  }

  events.sort((a, b) => a.timestampMs - b.timestampMs);
  return events;
}

async function collectJsonlFiles(dirPath: string): Promise<string[]> {
  const entries = await safeReadDir(dirPath);
  const results: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectJsonlFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      results.push(fullPath);
    }
  }

  return results;
}

async function safeReadDir(dirPath: string): Promise<fs.Dirent[]> {
  try {
    return await fsp.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function parseCodexSessionFile(
  filePath: string,
  sessionsDir: string,
  options: CodexParseOptions,
): Promise<CodexUsageEvent[]> {
  const input = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const events: CodexUsageEvent[] = [];
  let previousTotals: RawUsage | null = null;
  let currentModel: string | null = null;
  const sessionId = path.relative(sessionsDir, filePath).replace(/\\/g, "/").replace(/\.jsonl$/i, "");

  for await (const line of rl) {
    if (!line.includes("\"token_count\"") && !line.includes("\"turn_context\"")) {
      continue;
    }

    let entry: CodexLogEntry;
    try {
      entry = JSON.parse(line) as CodexLogEntry;
    } catch {
      continue;
    }

    if (entry.type === "turn_context") {
      if (typeof entry.payload?.model === "string" && entry.payload.model.trim()) {
        currentModel = entry.payload.model.trim();
      }
      continue;
    }

    if (entry.type !== "event_msg" || entry.payload?.type !== "token_count") {
      continue;
    }

    const timestamp = entry.timestamp ? DateTime.fromISO(entry.timestamp, { zone: "utc" }) : null;
    if (!timestamp || !timestamp.isValid) {
      continue;
    }

    const totalUsage = parseRawUsage(entry.payload?.info?.total_token_usage);
    const rawUsage = parseRawUsage(entry.payload?.info?.last_token_usage) ?? diffUsage(totalUsage, previousTotals);

    if (totalUsage) {
      previousTotals = totalUsage;
    }
    if (!rawUsage || isZeroUsage(rawUsage)) {
      continue;
    }

    const model =
      normalizeModel(entry.payload?.model) ??
      normalizeModel(entry.payload?.info?.model) ??
      currentModel;
    if (model) {
      currentModel = model;
    }

    const localDate = timestamp.setZone(options.timezone).toISODate();
    if (!localDate || !isDateInRange(localDate, options.from, options.to)) {
      continue;
    }

    events.push({
      source: "codex",
      sessionId,
      sessionPath: filePath,
      timestampMs: timestamp.toMillis(),
      isoTimestamp: timestamp.toUTC().toISO() || entry.timestamp || "",
      localDate,
      model,
      ...rawUsage,
    });
  }

  return events;
}

function normalizeModel(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseRawUsage(value: unknown): RawUsage | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const usage = {
    inputTokens: parseInteger((value as Record<string, unknown>).input_tokens),
    cachedInputTokens: parseInteger((value as Record<string, unknown>).cached_input_tokens),
    outputTokens: parseInteger((value as Record<string, unknown>).output_tokens),
    reasoningOutputTokens: parseInteger((value as Record<string, unknown>).reasoning_output_tokens),
    totalTokens: parseInteger((value as Record<string, unknown>).total_tokens),
  };

  return usage;
}

function diffUsage(current: RawUsage | null, previous: RawUsage | null): RawUsage | null {
  if (!current) {
    return null;
  }
  if (!previous) {
    return current;
  }

  return {
    inputTokens: Math.max(0, current.inputTokens - previous.inputTokens),
    cachedInputTokens: Math.max(0, current.cachedInputTokens - previous.cachedInputTokens),
    outputTokens: Math.max(0, current.outputTokens - previous.outputTokens),
    reasoningOutputTokens: Math.max(0, current.reasoningOutputTokens - previous.reasoningOutputTokens),
    totalTokens: Math.max(0, current.totalTokens - previous.totalTokens),
  };
}

function isZeroUsage(usage: RawUsage): boolean {
  return (
    usage.inputTokens === 0 &&
    usage.cachedInputTokens === 0 &&
    usage.outputTokens === 0 &&
    usage.reasoningOutputTokens === 0 &&
    usage.totalTokens === 0
  );
}

export function codexEventRowsForCsv(events: CodexUsageEvent[]): Array<Record<string, string | number | null>> {
  return events.map((event) => ({
    source: event.source,
    local_date: event.localDate,
    iso_timestamp: event.isoTimestamp,
    session_id: event.sessionId,
    model: event.model,
    input_tokens: event.inputTokens,
    cached_input_tokens: event.cachedInputTokens,
    output_tokens: event.outputTokens,
    reasoning_output_tokens: event.reasoningOutputTokens,
    total_tokens: event.totalTokens,
    session_path: event.sessionPath,
  }));
}

export function addCodexDailyValues(
  target: DailyUsageRow,
  events: CodexUsageEvent[],
  date: string,
): void {
  const matching = events.filter((event) => event.localDate === date);
  if (matching.length === 0) {
    return;
  }

  const sessionIds = new Set<string>();
  for (const event of matching) {
    sessionIds.add(event.sessionId);
    target.codexInputTokens += event.inputTokens;
    target.codexCachedInputTokens += event.cachedInputTokens;
    target.codexOutputTokens += event.outputTokens;
    target.codexReasoningOutputTokens += event.reasoningOutputTokens;
    target.codexTotalTokens += event.totalTokens;
  }
  target.codexSessionCount = sessionIds.size;
}
