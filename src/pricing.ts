import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PricingSummary } from "./contracts.js";
import type { CodexUsageEvent, CursorUsageEvent } from "./types.js";

interface PriceMappingRow {
  observed_name: string;
  canonical_model_name: string | null;
  pricing_context: string;
  billing_unit: string;
  input_price: number | null;
  cached_input_price: number | null;
  cache_read_price: number | null;
  cache_write_price: number | null;
  output_price: number | null;
}

interface EventEstimate {
  usd: number;
  mapped: boolean;
  observedName: string;
}

export interface PricingComputation {
  codexByDate: Map<string, number>;
  cursorByDate: Map<string, number>;
  codexByModel: Map<string, number>;
  cursorByModel: Map<string, number>;
  summary: PricingSummary;
}

let cachedRowsPromise: Promise<{ rows: PriceMappingRow[]; mappingPath: string | null }> | null = null;

export async function computeEstimatedPricing(
  codexEvents: CodexUsageEvent[],
  cursorEvents: CursorUsageEvent[],
): Promise<PricingComputation> {
  const { rows, mappingPath } = await loadPriceMappings();
  const codexByDate = new Map<string, number>();
  const cursorByDate = new Map<string, number>();
  const codexByModel = new Map<string, number>();
  const cursorByModel = new Map<string, number>();
  const unresolved = new Set<string>();

  let mappedCodexEvents = 0;
  let unmappedCodexEvents = 0;
  let mappedCursorEvents = 0;
  let unmappedCursorEvents = 0;
  let codexEstimatedCostUsd = 0;
  let cursorEstimatedCostUsd = 0;

  for (const event of codexEvents) {
    const estimate = estimateCodexEventUsd(event, rows);
    if (estimate.mapped) {
      mappedCodexEvents += 1;
    } else {
      unmappedCodexEvents += 1;
      unresolved.add(estimate.observedName);
    }
    codexEstimatedCostUsd += estimate.usd;
    addAmount(codexByDate, event.localDate, estimate.usd);
    addAmount(codexByModel, event.model ?? "unknown", estimate.usd);
  }

  for (const event of cursorEvents) {
    const estimate = estimateCursorEventUsd(event, rows);
    if (estimate.mapped) {
      mappedCursorEvents += 1;
    } else {
      unmappedCursorEvents += 1;
      unresolved.add(estimate.observedName);
    }
    cursorEstimatedCostUsd += estimate.usd;
    addAmount(cursorByDate, event.localDate, estimate.usd);
    addAmount(cursorByModel, event.model || "unknown", estimate.usd);
  }

  return {
    codexByDate,
    cursorByDate,
    codexByModel,
    cursorByModel,
    summary: {
      mappingPath,
      mappedCodexEvents,
      unmappedCodexEvents,
      mappedCursorEvents,
      unmappedCursorEvents,
      codexEstimatedCostUsd,
      cursorEstimatedCostUsd,
      combinedEstimatedCostUsd: codexEstimatedCostUsd + cursorEstimatedCostUsd,
      unresolvedObservedNames: [...unresolved].sort(),
    },
  };
}

function estimateCodexEventUsd(event: CodexUsageEvent, rows: PriceMappingRow[]): EventEstimate {
  const row = selectBestUsdRow(event.model ?? "unknown", "codex", rows);
  if (!row) {
    return { usd: 0, mapped: false, observedName: event.model ?? "unknown" };
  }

  const nonCachedInput = Math.max(event.inputTokens - event.cachedInputTokens, 0);
  const cachedInput = event.cachedInputTokens;
  const usd =
    usdForTokens(nonCachedInput, row.input_price) +
    usdForTokens(cachedInput, row.cached_input_price ?? row.cache_read_price ?? row.input_price) +
    usdForTokens(event.outputTokens, row.output_price);

  return { usd, mapped: true, observedName: event.model ?? "unknown" };
}

function estimateCursorEventUsd(event: CursorUsageEvent, rows: PriceMappingRow[]): EventEstimate {
  const row = selectBestUsdRow(event.model || "unknown", "cursor", rows);
  if (!row) {
    return { usd: 0, mapped: false, observedName: event.model || "unknown" };
  }

  const usd =
    usdForTokens(event.inputTokens, row.input_price) +
    usdForTokens(event.cacheWriteTokens, row.cache_write_price ?? row.input_price) +
    usdForTokens(event.cacheReadTokens, row.cache_read_price ?? row.cached_input_price ?? row.input_price) +
    usdForTokens(event.outputTokens, row.output_price);

  return { usd, mapped: true, observedName: event.model || "unknown" };
}

function usdForTokens(tokens: number, pricePerMillion: number | null): number {
  if (!pricePerMillion || tokens <= 0) {
    return 0;
  }
  return (tokens / 1_000_000) * pricePerMillion;
}

function selectBestUsdRow(
  observedName: string,
  source: "codex" | "cursor",
  rows: PriceMappingRow[],
): PriceMappingRow | null {
  const usableExactRows = rankRows(
    rows.filter((row) => row.observed_name === observedName && isUsdUsable(row)),
    source,
  );
  if (usableExactRows.length > 0) {
    return usableExactRows[0]!;
  }

  const aliasRows = rows.filter((row) => row.observed_name === observedName);
  const canonicalNames = aliasRows
    .map((row) => row.canonical_model_name)
    .filter((value): value is string => isUsefulCanonicalName(value));

  for (const canonicalName of canonicalNames) {
    const usableCanonicalRows = rankRows(
      rows.filter(
        (row) =>
          isUsdUsable(row) &&
          (row.observed_name === canonicalName || row.canonical_model_name === canonicalName),
      ),
      source,
    );
    if (usableCanonicalRows.length > 0) {
      return usableCanonicalRows[0]!;
    }
  }

  return null;
}

function rankRows(rows: PriceMappingRow[], source: "codex" | "cursor"): PriceMappingRow[] {
  const priorities =
    source === "codex"
      ? ["openai_api", "anthropic_api", "gemini_api", "xai_api", "cursor_manual_provider_price", "cursor_auto"]
      : ["cursor_auto", "cursor_manual_provider_price", "openai_api", "anthropic_api", "gemini_api", "xai_api"];

  return [...rows].sort((a, b) => {
    const left = priorities.indexOf(a.pricing_context);
    const right = priorities.indexOf(b.pricing_context);
    const leftRank = left === -1 ? Number.MAX_SAFE_INTEGER : left;
    const rightRank = right === -1 ? Number.MAX_SAFE_INTEGER : right;
    return leftRank - rightRank;
  });
}

function isUsdUsable(row: PriceMappingRow): boolean {
  return row.billing_unit === "usd_per_1m_tokens" && row.output_price != null && row.input_price != null;
}

function isUsefulCanonicalName(value: string | null): value is string {
  return Boolean(value && !/unresolved/i.test(value));
}

function addAmount(map: Map<string, number>, key: string, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

async function loadPriceMappings(): Promise<{ rows: PriceMappingRow[]; mappingPath: string | null }> {
  if (!cachedRowsPromise) {
    cachedRowsPromise = (async () => {
      const mappingPath = await resolveMappingPath();
      if (!mappingPath) {
        return { rows: [], mappingPath: null };
      }

      const raw = await fs.readFile(mappingPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      const rows = Array.isArray(parsed)
        ? (parsed as PriceMappingRow[])
        : Array.isArray((parsed as { items?: unknown[] }).items)
          ? ((parsed as { items: PriceMappingRow[] }).items)
          : [];

      return { rows, mappingPath };
    })();
  }

  return cachedRowsPromise;
}

async function resolveMappingPath(): Promise<string | null> {
  const envPath = process.env.AI_MODEL_PRICE_MAPPING_PATH?.trim();
  if (envPath) {
    return envPath;
  }

  const downloadsDir = path.join(os.homedir(), "Downloads");
  try {
    const entries = await fs.readdir(downloadsDir, { withFileTypes: true });
    const candidates = entries
      .filter((entry) => entry.isFile() && /^ai_model_price_mapping_.*\.json$/i.test(entry.name))
      .map((entry) => path.join(downloadsDir, entry.name));

    if (candidates.length === 0) {
      return null;
    }

    const withStats = await Promise.all(
      candidates.map(async (candidate) => ({
        candidate,
        mtimeMs: (await fs.stat(candidate)).mtimeMs,
      })),
    );

    withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return withStats[0]!.candidate;
  } catch {
    return null;
  }
}
