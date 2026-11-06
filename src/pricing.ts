import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PricingSummary } from "./contracts.js";
import type { CodexUsageEvent, CursorUsageEvent } from "./types.js";
import { VERIFIED_PRICE_UPDATES, type PriceMappingRow } from "./model-prices.js";

interface EventEstimate {
  usd: number;
  mapped: boolean;
  observedName: string;
}

const BUILTIN_PRICE_OVERRIDES: PriceMappingRow[] = [
  ...VERIFIED_PRICE_UPDATES,
  // OpenAI standard API prices, USD per 1M tokens. Cache writes are 1.25x
  // uncached input and cache reads receive a 90% discount.
  {
    observed_name: "gpt-6-astra",
    canonical_model_name: "gpt-6-astra",
    pricing_context: "openai_api",
    billing_unit: "usd_per_1m_tokens",
    input_price: 10,
    cached_input_price: 1,
    cache_read_price: 1,
    cache_write_price: 12.5,
    output_price: 50,
    long_context_threshold: 272_000,
    long_context_input_multiplier: 2,
    long_context_output_multiplier: 1.5,
  },
  {
    observed_name: "gpt-5.6-sol",
    canonical_model_name: "gpt-5.6-sol",
    pricing_context: "openai_api",
    billing_unit: "usd_per_1m_tokens",
    input_price: 4,
    cached_input_price: 0.4,
    cache_read_price: 0.4,
    cache_write_price: 5,
    output_price: 20,
    long_context_threshold: 272_000,
    long_context_input_multiplier: 2,
    long_context_output_multiplier: 1.5,
  },
  {
    observed_name: "gpt-5.6-terra",
    canonical_model_name: "gpt-5.6-terra",
    pricing_context: "openai_api",
    billing_unit: "usd_per_1m_tokens",
    input_price: 2,
    cached_input_price: 0.2,
    cache_read_price: 0.2,
    cache_write_price: 2.5,
    output_price: 12,
  },
  {
    observed_name: "gpt-5.6-luna",
    canonical_model_name: "gpt-5.6-luna",
    pricing_context: "openai_api",
    billing_unit: "usd_per_1m_tokens",
    input_price: 0.2,
    cached_input_price: 0.02,
    cache_read_price: 0.02,
    cache_write_price: 0.25,
    output_price: 1.2,
  },
  {
    observed_name: "gpt-5.5",
    canonical_model_name: "gpt-5.5",
    pricing_context: "openai_api",
    billing_unit: "usd_per_1m_tokens",
    input_price: 5,
    cached_input_price: 0.5,
    cache_read_price: 0.5,
    cache_write_price: null,
    output_price: 30,
  },
  {
    observed_name: "gpt-5.4",
    canonical_model_name: "gpt-5.4",
    pricing_context: "openai_api",
    billing_unit: "usd_per_1m_tokens",
    input_price: 2.5,
    cached_input_price: 0.25,
    cache_read_price: 0.25,
    cache_write_price: null,
    output_price: 15,
  },
  // Cursor publishes input, cache-read, and output rates for Composer 2.5.
  // A dash in its cache-write column deliberately falls back to input.
  {
    observed_name: "composer-2.5",
    canonical_model_name: "composer-2.5",
    pricing_context: "cursor_manual_provider_price",
    billing_unit: "usd_per_1m_tokens",
    input_price: 0.5,
    cached_input_price: 0.2,
    cache_read_price: 0.2,
    cache_write_price: null,
    output_price: 2.5,
  },
  {
    observed_name: "composer-2.5-fast",
    canonical_model_name: "composer-2.5-fast",
    pricing_context: "cursor_manual_provider_price",
    billing_unit: "usd_per_1m_tokens",
    input_price: 3,
    cached_input_price: 0.5,
    cache_read_price: 0.5,
    cache_write_price: null,
    output_price: 15,
  },
  {
    observed_name: "gemini-3.5-flash",
    canonical_model_name: "gemini-3.5-flash",
    pricing_context: "gemini_api",
    billing_unit: "usd_per_1m_tokens",
    input_price: 1.5,
    cached_input_price: 0.15,
    cache_read_price: 0.15,
    cache_write_price: 1.5,
    output_price: 9,
  },
  // Gemini 3.6 through 3.8 promotional pricing is effective through
  // December 31, 2026. Cursor reports the effort level as an alias suffix.
  {
    observed_name: "gemini-3.6-flash-high",
    canonical_model_name: "gemini-3.6-flash",
    pricing_context: "gemini_api",
    billing_unit: "usd_per_1m_tokens",
    input_price: 0.75,
    cached_input_price: 0.075,
    cache_read_price: 0.075,
    cache_write_price: 0.75,
    output_price: 3.75,
  },
  {
    observed_name: "gemini-3.7-flash-high",
    canonical_model_name: "gemini-3.7-flash",
    pricing_context: "cursor_manual_provider_price",
    billing_unit: "usd_per_1m_tokens",
    input_price: 0.75,
    cached_input_price: 0.075,
    cache_read_price: 0.075,
    cache_write_price: 0.75,
    output_price: 3.5,
  },
  {
    observed_name: "gemini-3.8-flash-low",
    canonical_model_name: "gemini-3.8-flash",
    pricing_context: "cursor_manual_provider_price",
    billing_unit: "usd_per_1m_tokens",
    input_price: 0.75,
    cached_input_price: 0.075,
    cache_read_price: 0.075,
    cache_write_price: null,
    output_price: 3.5,
  },
  {
    observed_name: "gemini-3.8-flash-medium",
    canonical_model_name: "gemini-3.8-flash",
    pricing_context: "cursor_manual_provider_price",
    billing_unit: "usd_per_1m_tokens",
    input_price: 0.75,
    cached_input_price: 0.075,
    cache_read_price: 0.075,
    cache_write_price: null,
    output_price: 3.5,
  },
  {
    observed_name: "gemini-3.8-flash-high",
    canonical_model_name: "gemini-3.8-flash",
    pricing_context: "cursor_manual_provider_price",
    billing_unit: "usd_per_1m_tokens",
    input_price: 0.75,
    cached_input_price: 0.075,
    cache_read_price: 0.075,
    cache_write_price: null,
    output_price: 3.5,
  },
  // Cursor first-party Grok Fast prices apply regardless of reasoning effort.
  {
    observed_name: "cursor-grok-4.6-high-fast",
    canonical_model_name: "grok-4.6-fast",
    pricing_context: "cursor_manual_provider_price",
    billing_unit: "usd_per_1m_tokens",
    input_price: 4,
    cached_input_price: 1,
    cache_read_price: 1,
    cache_write_price: null,
    output_price: 12,
  },
  {
    observed_name: "cursor-grok-4.6-xhigh-fast",
    canonical_model_name: "grok-4.6-fast",
    pricing_context: "cursor_manual_provider_price",
    billing_unit: "usd_per_1m_tokens",
    input_price: 4,
    cached_input_price: 1,
    cache_read_price: 1,
    cache_write_price: null,
    output_price: 12,
  },
  {
    observed_name: "claude-4.6-opus-max-thinking",
    canonical_model_name: "claude-opus-4-6",
    pricing_context: "anthropic_api",
    billing_unit: "usd_per_1m_tokens",
    input_price: 5,
    cached_input_price: 0.5,
    cache_read_price: 0.5,
    cache_write_price: 6.25,
    output_price: 25,
  },
  {
    observed_name: "claude-fable-5-max",
    canonical_model_name: "claude-fable-5",
    pricing_context: "anthropic_api",
    billing_unit: "usd_per_1m_tokens",
    input_price: 10,
    cached_input_price: 1,
    cache_read_price: 1,
    cache_write_price: 12.5,
    output_price: 50,
  },
  {
    observed_name: "claude-fable-5-thinking-max",
    canonical_model_name: "claude-fable-5",
    pricing_context: "anthropic_api",
    billing_unit: "usd_per_1m_tokens",
    input_price: 10,
    cached_input_price: 1,
    cache_read_price: 1,
    cache_write_price: 12.5,
    output_price: 50,
  },
  {
    observed_name: "claude-fable-5-thinking-high",
    canonical_model_name: "claude-fable-5",
    pricing_context: "anthropic_api",
    billing_unit: "usd_per_1m_tokens",
    input_price: 10,
    cached_input_price: 1,
    cache_read_price: 1,
    cache_write_price: 12.5,
    output_price: 50,
  },
  {
    observed_name: "claude-opus-5-thinking-max",
    canonical_model_name: "claude-opus-5",
    pricing_context: "anthropic_api",
    billing_unit: "usd_per_1m_tokens",
    input_price: 5,
    cached_input_price: 0.5,
    cache_read_price: 0.5,
    cache_write_price: 6.25,
    output_price: 25,
  },
  {
    observed_name: "claude-opus-4-8-max",
    canonical_model_name: "claude-opus-4-8",
    pricing_context: "anthropic_api",
    billing_unit: "usd_per_1m_tokens",
    input_price: 5,
    cached_input_price: 0.5,
    cache_read_price: 0.5,
    cache_write_price: 6.25,
    output_price: 25,
  },
  {
    observed_name: "claude-opus-4-8-thinking-max",
    canonical_model_name: "claude-opus-4-8",
    pricing_context: "anthropic_api",
    billing_unit: "usd_per_1m_tokens",
    input_price: 5,
    cached_input_price: 0.5,
    cache_read_price: 0.5,
    cache_write_price: 6.25,
    output_price: 25,
  },
];

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
  return calculateEstimatedPricing(codexEvents, cursorEvents, rows, mappingPath);
}

export function calculateEstimatedPricing(
  codexEvents: CodexUsageEvent[],
  cursorEvents: CursorUsageEvent[],
  rows: PriceMappingRow[] = BUILTIN_PRICE_OVERRIDES,
  mappingPath: string | null = null,
): PricingComputation {
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
  const usesLongContextPricing =
    row.long_context_threshold != null && event.inputTokens > row.long_context_threshold;
  const inputMultiplier = usesLongContextPricing ? (row.long_context_input_multiplier ?? 1) : 1;
  const outputMultiplier = usesLongContextPricing ? (row.long_context_output_multiplier ?? 1) : 1;
  const usd =
    usdForTokens(nonCachedInput, multiplyPrice(row.input_price, inputMultiplier)) +
    usdForTokens(
      cachedInput,
      multiplyPrice(row.cached_input_price ?? row.cache_read_price ?? row.input_price, inputMultiplier),
    ) +
    // Codex reasoning_output_tokens is a subset of output_tokens, not an extra charge.
    usdForTokens(event.outputTokens, multiplyPrice(row.output_price, outputMultiplier));

  return { usd, mapped: true, observedName: event.model ?? "unknown" };
}

function multiplyPrice(price: number | null, multiplier: number): number | null {
  return price == null ? null : price * multiplier;
}

function estimateCursorEventUsd(event: CursorUsageEvent, rows: PriceMappingRow[]): EventEstimate {
  const row = selectBestUsdRow(event.model || "unknown", "cursor", rows);
  if (!row) {
    return { usd: 0, mapped: false, observedName: event.model || "unknown" };
  }

  const promptTokens = event.inputTokens + event.cacheWriteTokens + event.cacheReadTokens;
  const usesLongContextPricing =
    row.long_context_threshold != null && promptTokens > row.long_context_threshold;
  const inputMultiplier = usesLongContextPricing ? (row.long_context_input_multiplier ?? 1) : 1;
  const outputMultiplier = usesLongContextPricing ? (row.long_context_output_multiplier ?? 1) : 1;
  const usd =
    usdForTokens(event.inputTokens, multiplyPrice(row.input_price, inputMultiplier)) +
    usdForTokens(event.cacheWriteTokens, multiplyPrice(row.cache_write_price ?? row.input_price, inputMultiplier)) +
    usdForTokens(event.cacheReadTokens, multiplyPrice(row.cache_read_price ?? row.cached_input_price ?? row.input_price, inputMultiplier)) +
    usdForTokens(event.outputTokens, multiplyPrice(row.output_price, outputMultiplier));

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
        return { rows: [...BUILTIN_PRICE_OVERRIDES], mappingPath: null };
      }

      const raw = await fs.readFile(mappingPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      const rows = Array.isArray(parsed)
        ? (parsed as PriceMappingRow[])
        : Array.isArray((parsed as { items?: unknown[] }).items)
          ? ((parsed as { items: PriceMappingRow[] }).items)
          : [];

      return { rows: mergePriceMappings(rows), mappingPath };
    })();
  }

  return cachedRowsPromise;
}

export function mergePriceMappings(externalRows: PriceMappingRow[]): PriceMappingRow[] {
  // Context ranking stays source-specific; equal-context legacy JSON cannot shadow updates.
  return [...BUILTIN_PRICE_OVERRIDES, ...externalRows];
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
