import assert from "node:assert/strict";
import test from "node:test";
import { calculateEstimatedPricing, mergePriceMappings } from "../src/pricing.js";
import { VERIFIED_PRICE_UPDATES } from "../src/model-prices.js";
import type { CodexUsageEvent, CursorUsageEvent } from "../src/types.js";

function codex(model: string, overrides: Partial<CodexUsageEvent> = {}): CodexUsageEvent {
  return {
    source: "codex", model, sessionId: "test", sessionPath: "test.jsonl",
    localDate: "2026-09-30", isoTimestamp: "2026-09-30T00:00:00Z", timestampMs: 0,
    inputTokens: 200_000, cachedInputTokens: 150_000, outputTokens: 10_000,
    reasoningOutputTokens: 6_000, totalTokens: 210_000,
    ...overrides,
  };
}

function cursor(model: string, overrides: Partial<CursorUsageEvent> = {}): CursorUsageEvent {
  return {
    source: "cursor", model, requestId: "test", kind: "Included", maxMode: "No",
    localDate: "2026-09-30", isoTimestamp: "2026-09-30T00:00:00Z", timestampMs: 0,
    inputTokens: 10_000, cacheWriteTokens: 20_000, cacheReadTokens: 150_000,
    outputTokens: 10_000, totalTokens: 190_000, costUsd: 0,
    ...overrides,
  };
}

function close(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

test("new GPT models price uncached input, cache reads and output without double-counting reasoning", () => {
  for (const [model, expected] of [["gpt-6-sol", 0.23], ["gpt-6.1-sol", 0.215], ["gpt-6-luna", 0.0115]] as const) {
    const result = calculateEstimatedPricing([codex(model)], []);
    close(result.summary.codexEstimatedCostUsd, expected);
    assert.equal(result.summary.mappedCodexEvents, 1);
  }
});

test("GPT long context starts strictly above 272K input tokens, including cached input", () => {
  const boundary = codex("gpt-6.1-sol", { inputTokens: 272_000, cachedInputTokens: 250_000 });
  close(calculateEstimatedPricing([boundary], []).summary.codexEstimatedCostUsd, 0.169);
  const long = { ...boundary, inputTokens: 272_001 };
  close(calculateEstimatedPricing([long], []).summary.codexEstimatedCostUsd, 0.288004);
});

test("Cursor Claude variants separate input, cache writes, reads and output", () => {
  for (const [model, expected] of [
    ["claude-sonnet-5-5-max", 0.20],
    ["claude-sonnet-5-5-xhigh", 0.20],
    ["claude-opus-5-thinking-high", 0.50],
    ["claude-opus-5-5-thinking-high", 0.37],
    ["claude-opus-5-5-thinking-high-fast", 0.74],
    ["claude-fable-5-1-thinking-high", 0.8875],
  ] as const) {
    const result = calculateEstimatedPricing([], [cursor(model)]);
    close(result.summary.cursorEstimatedCostUsd, expected);
    assert.equal(result.summary.mappedCursorEvents, 1);
  }
});

test("Cursor DeepSeek V4.1 Flash 1017 prices every documented reasoning level", () => {
  const names = ["deepseek-v4.1-flash-1017", "deepseek-v41-flash-1017",
    ...["none", "low", "medium", "high", "max"].map((level) => `deepseek-v41-flash-1017-${level}`)];
  for (const model of names) {
    const result = calculateEstimatedPricing([], [cursor(model)]);
    assert.equal(result.summary.mappedCursorEvents, 1, model);
    close(result.summary.cursorEstimatedCostUsd, 0.0219);
  }
});

test("Cursor DeepSeek V4.1 Flash 1017 keeps flat pricing for long prompts", () => {
  const event = cursor("deepseek-v41-flash-1017-max", { cacheReadTokens: 950_000, totalTokens: 990_000 });
  close(calculateEstimatedPricing([], [event]).summary.cursorEstimatedCostUsd, 0.0267);
});

test("Grok standard and Fast have distinct long-context rates based on prompt length", () => {
  const boundary = cursor("cursor-grok-4.7-high-fast", {
    inputTokens: 6_000, cacheWriteTokens: 0, cacheReadTokens: 250_000, outputTokens: 50_000,
  });
  close(calculateEstimatedPricing([], [boundary]).summary.cursorEstimatedCostUsd, 0.874);
  close(calculateEstimatedPricing([], [{ ...boundary, inputTokens: 6_001 }]).summary.cursorEstimatedCostUsd, 1.311006);
  close(calculateEstimatedPricing([], [{ ...boundary, model: "cursor-grok-4.7-high", inputTokens: 6_001 }]).summary.cursorEstimatedCostUsd, 0.874004);
});

test("Muse explicitly has no cache-write charge; Claude 5.5 has no long-context surcharge", () => {
  close(calculateEstimatedPricing([], [cursor("muse-spark-1.3-high")]).summary.cursorEstimatedCostUsd, 0.0775);
  const large = cursor("claude-opus-5-5", { cacheReadTokens: 950_000 });
  close(calculateEstimatedPricing([], [large]).summary.cursorEstimatedCostUsd, 0.53);
});

test("Gemini Pro long-context input length includes cached tokens", () => {
  const boundary = cursor("gemini-3.1-pro", { inputTokens: 50_000, cacheWriteTokens: 0, cacheReadTokens: 150_000 });
  close(calculateEstimatedPricing([], [boundary]).summary.cursorEstimatedCostUsd, 0.25);
  close(calculateEstimatedPricing([], [{ ...boundary, inputTokens: 50_001 }]).summary.cursorEstimatedCostUsd, 0.440004);
});

test("verified prices override stale JSON in the same billing context", () => {
  const stale = { ...VERIFIED_PRICE_UPDATES.find((row) => row.observed_name === "gpt-6.1-sol")!, input_price: 999 };
  close(calculateEstimatedPricing([codex("gpt-6.1-sol")], [], mergePriceMappings([stale])).summary.codexEstimatedCostUsd, 0.215);
});

test("unpublished names and unverified Fast variants remain unresolved", () => {
  const result = calculateEstimatedPricing([codex("codex-auto-review"), codex("gpt-6.1-sol-unpublished")], [
    cursor("claude-sonnet-5-5-fast"), cursor("deepseek-v41-flash-1017-fast"),
  ]);
  assert.equal(result.summary.unmappedCodexEvents, 2);
  assert.equal(result.summary.unmappedCursorEvents, 2);
  assert.equal(result.summary.combinedEstimatedCostUsd, 0);
});

test("model/date breakdowns reconcile with the combined cost", () => {
  const result = calculateEstimatedPricing([codex("gpt-6.1-sol"), codex("gpt-6-luna")], [cursor("claude-sonnet-5-5-max")]);
  const sum = (map: Map<string, number>) => [...map.values()].reduce((a, b) => a + b, 0);
  close(sum(result.codexByDate) + sum(result.cursorByDate), result.summary.combinedEstimatedCostUsd);
  close(sum(result.codexByModel) + sum(result.cursorByModel), result.summary.combinedEstimatedCostUsd);
});
