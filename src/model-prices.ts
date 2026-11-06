export interface PriceMappingRow {
  observed_name: string;
  canonical_model_name: string | null;
  pricing_context: string;
  billing_unit: string;
  input_price: number | null;
  cached_input_price: number | null;
  cache_read_price: number | null;
  cache_write_price: number | null;
  output_price: number | null;
  long_context_threshold?: number;
  long_context_input_multiplier?: number;
  long_context_output_multiplier?: number;
  source_url?: string;
  verified_at?: string;
}

type Rates = readonly [input: number, cacheRead: number, cacheWrite: number | null, output: number];
type ContextRates = Pick<PriceMappingRow,
  "long_context_threshold" | "long_context_input_multiplier" | "long_context_output_multiplier">;

const VERIFIED_AT = "2026-09-30";
const CURSOR_PRICING = "https://cursor.com/docs/models-and-pricing";
const OPENAI_LONG_CONTEXT: ContextRates = {
  long_context_threshold: 272_000,
  long_context_input_multiplier: 2,
  long_context_output_multiplier: 1.5,
};

function priceRows(
  model: string,
  names: string[],
  context: string,
  rates: Rates,
  sourceUrl: string,
  longContext: ContextRates = {},
  verifiedAt = VERIFIED_AT,
): PriceMappingRow[] {
  return [...new Set([model, ...names])].map((name) => ({
    observed_name: name,
    canonical_model_name: model,
    pricing_context: context,
    billing_unit: "usd_per_1m_tokens",
    input_price: rates[0],
    cached_input_price: rates[1],
    cache_read_price: rates[1],
    cache_write_price: rates[2],
    output_price: rates[3],
    source_url: sourceUrl,
    verified_at: verifiedAt,
    ...longContext,
  }));
}

function effortNames(model: string, levels: string[], thinking = false): string[] {
  return [
    model,
    ...levels.map((level) => `${model}-${level}`),
    ...(thinking ? [`${model}-thinking`, ...levels.map((level) => `${model}-thinking-${level}`)] : []),
  ];
}

const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const GROK_EFFORTS = ["low", "medium", "high", "xhigh"];
const grokNames = ["grok-4.7", "cursor-grok-4.7"].flatMap((name) => effortNames(name, GROK_EFFORTS));

// Explicit, source-backed families only. Never strip arbitrary suffixes from unknown models.
export const VERIFIED_PRICE_UPDATES: PriceMappingRow[] = [
  ...priceRows("deepseek-v4.1-flash-1017",
    effortNames("deepseek-v41-flash-1017", ["none", "low", "medium", "high", "max"]),
    "cursor_manual_provider_price", [0.3, 0.006, null, 1.2],
    "https://cursor.com/docs/models/deepseek-v4-1-flash-1017", {}, "2026-11-06"),
  ...priceRows("gpt-6-sol", [], "openai_api", [2, 0.2, 2.5, 10],
    "https://developers.openai.com/api/docs/models/gpt-6-sol", OPENAI_LONG_CONTEXT),
  ...priceRows("gpt-6.1-sol", [], "openai_api", [2, 0.1, 2.5, 10],
    "https://developers.openai.com/api/docs/models/gpt-6.1-sol", OPENAI_LONG_CONTEXT),
  ...priceRows("gpt-6-luna", [], "openai_api", [0.1, 0.01, 0.125, 0.5],
    "https://developers.openai.com/api/docs/models/gpt-6-luna", OPENAI_LONG_CONTEXT),
  ...priceRows("claude-sonnet-5-5", effortNames("claude-sonnet-5-5", CLAUDE_EFFORTS, true),
    "cursor_manual_provider_price", [2, 0.2, 2.5, 10],
    "https://cursor.com/docs/models/claude-sonnet-5-5"),
  ...priceRows("claude-opus-5-5", effortNames("claude-opus-5-5", CLAUDE_EFFORTS, true),
    "cursor_manual_provider_price", [4, 0.2, 5, 20],
    "https://cursor.com/docs/models/claude-opus-5-5"),
  ...priceRows("claude-opus-5-5-fast",
    effortNames("claude-opus-5-5", CLAUDE_EFFORTS, true).map((name) => `${name}-fast`),
    "cursor_manual_provider_price", [8, 0.4, 10, 40],
    "https://cursor.com/docs/models/claude-opus-5-5"),
  ...priceRows("claude-fable-5-1", effortNames("claude-fable-5-1", CLAUDE_EFFORTS, true),
    "cursor_manual_provider_price", [10, 0.25, 12.5, 50],
    "https://cursor.com/docs/models/claude-fable-5-1"),
  ...priceRows("claude-opus-5", effortNames("claude-opus-5", CLAUDE_EFFORTS, true),
    "anthropic_api", [5, 0.5, 6.25, 25],
    "https://platform.claude.com/docs/en/models/opus-5/overview"),
  ...priceRows("grok-4.7", grokNames, "cursor_manual_provider_price", [2, 0.5, null, 6],
    "https://cursor.com/docs/models/grok-4-7", {
      long_context_threshold: 256_000,
      long_context_input_multiplier: 2,
      long_context_output_multiplier: 2,
    }),
  ...priceRows("grok-4.7-fast", grokNames.map((name) => `${name}-fast`),
    "cursor_manual_provider_price", [4, 1, null, 12],
    "https://cursor.com/docs/models/grok-4-7", {
      long_context_threshold: 256_000,
      long_context_input_multiplier: 1.5,
      long_context_output_multiplier: 1.5,
    }),
  ...priceRows("muse-spark-1.3",
    effortNames("muse-spark-1.3", ["minimal", ...CLAUDE_EFFORTS]),
    "cursor_manual_provider_price", [1.25, 0.15, 0, 4.25],
    "https://cursor.com/docs/models/muse-spark-1-3"),
  ...priceRows("gemini-3.1-pro", ["gemini-3.1-pro-preview"],
    "cursor_manual_provider_price", [2, 0.2, null, 12], CURSOR_PRICING, {
      long_context_threshold: 200_000,
      long_context_input_multiplier: 2,
      long_context_output_multiplier: 1.5,
    }),
];
