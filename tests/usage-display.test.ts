import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { App, ReportWarnings, UsageLimitsBoard } from "../src/renderer/App.js";
import type { UsageLimitsSnapshot } from "../src/contracts.js";

function snapshot(): UsageLimitsSnapshot {
  return {
    fetchedAt: "2026-09-30T05:35:41Z",
    codex: {
      configured: true, error: null, planType: "prolite", primaryWindow: null,
      secondaryWindow: { usedPercent: 22, resetAt: "2026-10-05T00:00:00Z" },
    },
    cursor: {
      configured: true, error: null, membershipType: "pro",
      primaryWindow: { usedPercent: 1.506878306878307, resetAt: "2026-10-18T14:31:26Z" },
      secondaryWindow: null, tertiaryWindow: null, requestLimit: 500,
      rawPlanUsed: 712, rawPlanLimit: 2000, rawPlanRemaining: 1288,
    },
  };
}

function render(limits: UsageLimitsSnapshot): string {
  return renderToStaticMarkup(createElement(UsageLimitsBoard, { limits, error: null }));
}

function percentages(html: string): number[] {
  return [...html.matchAll(/class="usage-limit-percent">(\d+)%/g)].map((match) => Number(match[1]));
}

test("Codex and Cursor both display remaining quota, using the actual plan budget", () => {
  const html = render(snapshot());
  assert.deepEqual(percentages(html), [78, 64]);
  assert.match(html, /width:64\.4%/);
  assert.doesNotMatch(html, /178\/500/);
});

test("zero remaining quota has a truly empty progress bar", () => {
  const limits = snapshot();
  limits.cursor.rawPlanUsed = 2000;
  limits.cursor.rawPlanRemaining = 0;
  const html = render(limits);
  assert.deepEqual(percentages(html), [78, 0]);
  assert.match(html, /width:0%/);
  assert.doesNotMatch(html, /width:2%/);
});

test("fallback API percentages are interpreted as used, never as remaining", () => {
  const limits = snapshot();
  limits.cursor.rawPlanUsed = null;
  limits.cursor.rawPlanLimit = null;
  limits.cursor.rawPlanRemaining = null;
  limits.cursor.primaryWindow!.usedPercent = 25;
  assert.deepEqual(percentages(render(limits)), [78, 75]);
});

test("missing quota remains unavailable, not a made-up 100 percent", () => {
  const limits = snapshot();
  limits.cursor.primaryWindow = null;
  limits.cursor.rawPlanUsed = null;
  limits.cursor.rawPlanLimit = null;
  limits.cursor.rawPlanRemaining = null;
  assert.deepEqual(percentages(render(limits)), [78]);
});

test("overspent and negative values are clamped to valid remaining percentages", () => {
  const limits = snapshot();
  limits.codex.secondaryWindow!.usedPercent = -5;
  limits.cursor.rawPlanUsed = 2500;
  assert.deepEqual(percentages(render(limits)), [100, 0]);
});

test("Activity does not show time-control placeholders while loading", () => {
  const html = renderToStaticMarkup(createElement(App));
  assert.doesNotMatch(html, /skeleton-switch|skeleton-dates|activity-controls/);
});

test("partial reports explicitly say that Cursor is excluded from totals", () => {
  const html = renderToStaticMarkup(createElement(ReportWarnings, {
    warnings: [{ source: "cursor", message: "Check your sign-in, then refresh Tokn." }],
  }));
  assert.match(html, /role="status"/);
  assert.match(html, /Cursor usage unavailable/);
  assert.match(html, /Totals exclude Cursor until it reconnects/);
});
