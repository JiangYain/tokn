import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { generateReport } from "../src/service.js";

test("Cursor authentication failure keeps the local Codex report available", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tokn-report-test-"));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await fs.rm(root, { recursive: true, force: true });
  });
  const codexRoot = path.join(root, "codex");
  await fs.mkdir(path.join(codexRoot, "sessions"), { recursive: true });
  await fs.writeFile(path.join(codexRoot, "sessions", "session.jsonl"), JSON.stringify({
    timestamp: "2026-11-06T01:00:00Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      model: "gpt-5.4",
      info: { last_token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } },
    },
  }) + "\n");
  t.mock.method(globalThis, "fetch", async () => new Response("Unauthorized", { status: 401 }));

  const result = await generateReport({
    from: "2026-11-06",
    to: "2026-11-06",
    timezone: "Asia/Shanghai",
    sources: ["codex", "cursor"],
    codexRoot,
    outDir: path.join(root, "reports"),
    cursorSessionToken: "invalid-test-session",
  });

  assert.equal(result.summary.codex.totalTokens, 120);
  assert.equal(result.counts.codexEvents, 1);
  assert.equal(result.counts.cursorEvents, 0);
  assert.deepEqual(result.warnings, [{ source: "cursor", message: "Cursor dashboard auth failed. Refresh your Cursor login state and try again." }]);
  assert.match(await fs.readFile(result.files.dailyCsvPath, "utf8"), /120/);
  assert.match(await fs.readFile(result.files.dailyMarkdownPath, "utf8"), /cursor usage unavailable; totals exclude this source/);
});
