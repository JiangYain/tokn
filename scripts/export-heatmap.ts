import fs from "node:fs/promises";
import path from "node:path";

import type { AppReportOptions } from "../src/contracts.js";
import { defaultTimezone, parseIsoDateOrThrow } from "../src/util.js";
import { generateReport, getAppDefaults } from "../src/service.js";

type Source = "codex" | "cursor";

type ExportArgs = {
  from: string;
  to: string;
  timezone: string;
  sources: Source[];
  outDir: string;
  codexRoot: string;
  outFile: string;
  cursorSessionToken?: string;
  cursorCookie?: string;
  cursorAppDir?: string;
  cursorCliConfigPath?: string;
};

type HeatmapExportRow = {
  date: string;
  tokens: number;
  costUsd: number;
  codexTokens: number;
  cursorTokens: number;
};

type HeatmapExportPayload = {
  generatedAt: string;
  from: string;
  to: string;
  timezone: string;
  source: {
    files: {
      from: string;
      to: string;
    };
    codexRoot: string;
    cursorAppDir: string | null;
    cursorCliConfigPath: string | null;
    sources: Source[];
  };
  rows: HeatmapExportRow[];
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const report = await generateReport({
    from: args.from,
    to: args.to,
    timezone: args.timezone,
    sources: args.sources,
    outDir: args.outDir,
    codexRoot: args.codexRoot,
    cursorSessionToken: args.cursorSessionToken,
    cursorCookie: args.cursorCookie,
    cursorAppDir: args.cursorAppDir,
    cursorCliConfigPath: args.cursorCliConfigPath,
  } satisfies AppReportOptions);

  const payload: HeatmapExportPayload = {
    generatedAt: new Date().toISOString(),
    from: args.from,
    to: args.to,
    timezone: args.timezone,
    source: {
      files: {
        from: args.from,
        to: args.to,
      },
      codexRoot: args.codexRoot,
      cursorAppDir: args.cursorAppDir ?? null,
      cursorCliConfigPath: args.cursorCliConfigPath ?? null,
      sources: args.sources,
    },
    rows: report.rows.map((row) => ({
      date: row.date,
      tokens: row.combinedTotalTokens,
      costUsd: row.combinedEstimatedCostUsd,
      codexTokens: row.codexTotalTokens,
      cursorTokens: row.cursorTotalTokens,
    })),
  };

  await fs.mkdir(path.dirname(args.outFile), { recursive: true });
  await fs.writeFile(args.outFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  process.stdout.write(
    `Token heatmap exported: ${args.from}..${args.to} (${args.timezone})
Rows: ${payload.rows.length}
Output: ${args.outFile}
`,
  );
}

function parseArgs(argv: string[]): ExportArgs {
  const defaults = getAppDefaults(defaultTimezone());
  const from = parseOption(argv, "--from") || defaults.from;
  const to = parseOption(argv, "--to") || defaults.to;
  const timezone = parseOption(argv, "--timezone") || defaults.timezone;
  const sources = parseSources(parseOption(argv, "--sources") || "codex,cursor");
  const outDir = parseOption(argv, "--out-dir") || defaults.outDir;
  const outFileArg = parseOption(argv, "--out-file");
  const outFile = outFileArg || path.join(outDir, `token-heatmap-${timezone.replaceAll("/", "-")}-${from}__${to}.json`);
  const codexRoot = parseOption(argv, "--codex-root") || defaults.codexRoot;
  const cursorAppDir = parseOption(argv, "--cursor-app-dir");
  const cursorCliConfigPath = parseOption(argv, "--cursor-cli-config");
  const cursorSessionToken = parseOption(argv, "--cursor-session-token");
  const cursorCookie = parseOption(argv, "--cursor-cookie");

  return {
    from: parseIsoDateOrThrow(from, "--from"),
    to: parseIsoDateOrThrow(to, "--to"),
    timezone,
    sources,
    outDir,
    outFile,
    codexRoot,
    cursorAppDir,
    cursorCliConfigPath,
    cursorSessionToken,
    cursorCookie,
  };
}

function parseOption(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${name}`);
  }

  return value;
}

function parseSources(value: string): Source[] {
  const parts = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const valid = new Set<Source>();
  for (const part of parts) {
    if (part !== "codex" && part !== "cursor") {
      throw new Error(`Unsupported source: ${part}`);
    }
    valid.add(part);
  }

  if (valid.size === 0) {
    throw new Error("At least one source is required.");
  }

  return [...valid];
}

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
