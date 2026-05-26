import path from "node:path";
import { inspectCursorAuth, generateReport } from "./service.js";
import type { ParsedCliArgs, ReportOptions } from "./types.js";
import {
  defaultTimezone,
  formatInt,
  parseIsoDateOrThrow,
  resolveDefaultCodexRoot,
  startOfMonthInZone,
  todayInZone,
} from "./util.js";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "help") {
    printHelp();
    return;
  }

  if (args.command === "cursor-auth") {
    const auth = inspectCursorAuth(args.options);
    process.stdout.write(JSON.stringify(auth, null, 2) + "\n");
    return;
  }

  await runReport(args.options);
}

async function runReport(options: ReportOptions): Promise<void> {
  const result = await generateReport(options);
  const authSource = result.cursorAuth ? result.cursorAuth.source : "skipped";
  process.stdout.write(
    [
      `Report written to ${options.outDir}`,
      `Range: ${options.from} .. ${options.to} (${options.timezone})`,
      `Codex events: ${formatInt(result.counts.codexEvents)}`,
      `Cursor events: ${formatInt(result.counts.cursorEvents)}`,
      `Cursor auth source: ${authSource}`,
      `Combined total tokens: ${formatInt(result.summary.combined.totalTokens)}`,
      `Codex total tokens: ${formatInt(result.summary.codex.totalTokens)}`,
      `Cursor total tokens: ${formatInt(result.summary.cursor.totalTokens)}`,
      `CSV: ${result.files.dailyCsvPath}`,
      `Markdown: ${result.files.dailyMarkdownPath}`,
    ].join("\n") + "\n",
  );
}

function parseArgs(argv: string[]): ParsedCliArgs {
  const command = readCommand(argv);
  const timezone = readOption(argv, "--timezone") || defaultTimezone();
  const from = parseIsoDateOrThrow(readOption(argv, "--from") || startOfMonthInZone(timezone), "--from");
  const to = parseIsoDateOrThrow(readOption(argv, "--to") || todayInZone(timezone), "--to");
  const sources = parseSources(readOption(argv, "--sources") || "codex,cursor");
  const outDir =
    readOption(argv, "--out-dir") || path.join(process.cwd(), "reports", todayInZone(timezone));

  const options: ReportOptions = {
    from,
    to,
    timezone,
    sources,
    outDir,
    codexRoot: readOption(argv, "--codex-root") || resolveDefaultCodexRoot(),
    cursorSessionToken: readOption(argv, "--cursor-session-token"),
    cursorCookie: readOption(argv, "--cursor-cookie"),
    cursorAppDir: readOption(argv, "--cursor-app-dir"),
    cursorCliConfigPath: readOption(argv, "--cursor-cli-config"),
  };

  return { command, options };
}

function readCommand(argv: string[]): ParsedCliArgs["command"] {
  const first = argv[0];
  if (!first || first.startsWith("--")) {
    return "report";
  }
  if (first === "report" || first === "cursor-auth" || first === "help") {
    return first;
  }
  throw new Error(`Unknown command: ${first}`);
}

function readOption(argv: string[], name: string): string | undefined {
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

function parseSources(value: string): Array<"codex" | "cursor"> {
  const parts = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const valid = new Set<"codex" | "cursor">();
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

function printHelp(): void {
  process.stdout.write(
    [
      "daily-token-monitor",
      "",
      "Commands:",
      "  report       Generate daily CSV and Markdown reports (default)",
      "  cursor-auth  Inspect discovered Cursor auth metadata",
      "  help         Show this help",
      "",
      "Options:",
      "  --from YYYY-MM-DD",
      "  --to YYYY-MM-DD",
      "  --timezone Asia/Shanghai",
      "  --sources codex,cursor",
      "  --codex-root C:\\Users\\you\\.codex",
      "  --out-dir C:\\path\\to\\reports",
      "  --cursor-session-token TOKEN",
      "  --cursor-cookie WorkosCursorSessionToken=...",
      "  --cursor-app-dir C:\\Users\\you\\AppData\\Roaming\\Cursor",
      "  --cursor-cli-config C:\\Users\\you\\.cursor\\cli-config.json",
    ].join("\n") + "\n",
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});
