import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { parse as parseCsv } from "csv-parse/sync";
import { DateTime } from "luxon";
import type { CursorAuth, CursorPaths, CursorUsageEvent, DailyUsageRow } from "./types.js";
import { isDateInRange, parseInteger, parseMoney, readJwtExpiryIso } from "./util.js";

interface CursorLoadOptions {
  timezone: string;
  from: string;
  to: string;
  sessionToken?: string;
  cookieHeader?: string;
  cursorAppDir?: string;
  cursorCliConfigPath?: string;
}

const CURSOR_TOKEN_SQL = "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken';";
const CURSOR_CSV_URL = "https://cursor.com/api/dashboard/export-usage-events-csv";
const require = createRequire(import.meta.url);

export function resolveCursorPaths(options?: {
  homeDir?: string;
  cursorAppDir?: string;
  cursorCliConfigPath?: string;
}): CursorPaths {
  const homeDir = options?.homeDir || os.homedir();
  const appDir =
    options?.cursorAppDir ||
    path.join(process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"), "Cursor");

  return {
    appDir,
    stateDbPath: path.join(appDir, "User", "globalStorage", "state.vscdb"),
    cliConfigPath: options?.cursorCliConfigPath || path.join(homeDir, ".cursor", "cli-config.json"),
  };
}

export function resolveCursorAuth(options: CursorLoadOptions): CursorAuth {
  const explicitCookie = options.cookieHeader?.trim();
  if (explicitCookie) {
    return {
      cookieHeader: explicitCookie.startsWith("WorkosCursorSessionToken=")
        ? explicitCookie
        : `WorkosCursorSessionToken=${explicitCookie}`,
      userId: null,
      source: "cli",
      stateDbPath: null,
      cliConfigPath: null,
      expiresAtIso: null,
    };
  }

  const explicitToken = options.sessionToken?.trim() || process.env.CURSOR_SESSION_TOKEN?.trim();
  if (explicitToken) {
    return {
      cookieHeader: explicitToken.startsWith("WorkosCursorSessionToken=")
        ? explicitToken
        : `WorkosCursorSessionToken=${explicitToken}`,
      userId: null,
      source: options.sessionToken ? "cli" : "env",
      stateDbPath: null,
      cliConfigPath: null,
      expiresAtIso: null,
    };
  }

  const paths = resolveCursorPaths({
    cursorAppDir: options.cursorAppDir,
    cursorCliConfigPath: options.cursorCliConfigPath,
  });

  if (!fs.existsSync(paths.stateDbPath)) {
    throw new Error(`Cursor state database not found: ${paths.stateDbPath}`);
  }

  const jwt = readCursorAccessToken(paths.stateDbPath);
  if (!jwt) {
    throw new Error("Could not read Cursor access token from state.vscdb");
  }

  const userId = readCursorUserId(paths.cliConfigPath) || readCursorUserIdFromJwt(jwt);
  if (!userId) {
    throw new Error("Could not determine Cursor user id from local login state");
  }

  return {
    cookieHeader: `WorkosCursorSessionToken=${userId}%3A%3A${jwt}`,
    userId,
    source: "local",
    stateDbPath: paths.stateDbPath,
    cliConfigPath: paths.cliConfigPath,
    expiresAtIso: readJwtExpiryIso(jwt),
  };
}

function readCursorAccessToken(stateDbPath: string): string | null {
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(stateDbPath);
  try {
    const row = db.prepare(CURSOR_TOKEN_SQL).get() as { value?: unknown } | undefined;
    return typeof row?.value === "string" && row.value.trim() ? row.value.trim() : null;
  } finally {
    db.close();
  }
}

function readCursorUserId(cliConfigPath: string): string | null {
  try {
    const raw = fs.readFileSync(cliConfigPath, "utf8");
    const parsed = JSON.parse(raw) as { authInfo?: { authId?: string } };
    return normalizeCursorSubject(parsed.authInfo?.authId);
  } catch {
    return null;
  }
}

function readCursorUserIdFromJwt(jwt: string): string | null {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as {
      sub?: string;
    };
    return normalizeCursorSubject(payload.sub);
  } catch {
    return null;
  }
}

function normalizeCursorSubject(subject: string | undefined): string | null {
  if (!subject) {
    return null;
  }
  const native = subject.match(/\|(user_[A-Za-z0-9_]+)$/);
  if (native?.[1]) {
    return native[1];
  }
  if (/^(google-oauth2|github|oidc|auth0)\|[^|]+$/.test(subject)) {
    return subject;
  }
  return null;
}

export async function loadCursorEvents(options: CursorLoadOptions): Promise<{
  auth: CursorAuth;
  events: CursorUsageEvent[];
}> {
  const auth = resolveCursorAuth(options);
  const csvText = await fetchCursorUsageCsv({
    cookieHeader: auth.cookieHeader,
    from: options.from,
    to: options.to,
    timezone: options.timezone,
  });
  return {
    auth,
    events: parseCursorUsageCsv(csvText, options.timezone, options.from, options.to),
  };
}

async function fetchCursorUsageCsv(options: {
  cookieHeader: string;
  from: string;
  to: string;
  timezone: string;
}): Promise<string> {
  const url = new URL(CURSOR_CSV_URL);
  url.searchParams.set("strategy", "tokens");

  const start = DateTime.fromISO(options.from, { zone: options.timezone }).startOf("day");
  const end = DateTime.fromISO(options.to, { zone: options.timezone }).endOf("day");
  url.searchParams.set("startDate", String(start.toUTC().toMillis()));
  url.searchParams.set("endDate", String(end.toUTC().toMillis()));

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "text/csv,text/plain,*/*",
      Cookie: options.cookieHeader,
      Referer: "https://www.cursor.com/settings",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    },
    redirect: "follow",
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("Cursor dashboard auth failed. Refresh your Cursor login state and try again.");
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Cursor CSV request failed with ${response.status}: ${body.slice(0, 400)}`);
  }

  return response.text();
}

export function parseCursorUsageCsv(
  csvText: string,
  timezone: string,
  from: string,
  to: string,
): CursorUsageEvent[] {
  if (!csvText.trim()) {
    return [];
  }

  const rows = parseCsv(csvText, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as Array<Record<string, string>>;

  const events: CursorUsageEvent[] = [];
  rows.forEach((row, index) => {
    const dateValue = pickFirst(row, ["Date"]);
    if (!dateValue) {
      return;
    }

    const { localDate, isoTimestamp, timestampMs } = parseCursorDate(dateValue, timezone);
    if (!isDateInRange(localDate, from, to)) {
      return;
    }

    const inputWithCacheWrite = parseInteger(pickFirst(row, ["Input (w/ Cache Write)"]));
    const inputWithoutCacheWrite = parseInteger(pickFirst(row, ["Input (w/o Cache Write)"]));
    const cacheWriteTokens = Math.max(0, inputWithCacheWrite - inputWithoutCacheWrite);
    const cacheReadTokens = parseInteger(pickFirst(row, ["Cache Read"]));
    const outputTokens = parseInteger(pickFirst(row, ["Output Tokens"]));
    const totalTokens =
      parseInteger(pickFirst(row, ["Total Tokens"])) ||
      inputWithCacheWrite + cacheReadTokens + outputTokens;

    events.push({
      source: "cursor",
      requestId: `${dateValue}:${index + 1}`,
      timestampMs,
      isoTimestamp,
      localDate,
      model: pickFirst(row, ["Model"]) || "unknown",
      kind: pickFirst(row, ["Kind"]) || "unknown",
      maxMode: pickFirst(row, ["Max Mode"]) || "No",
      inputTokens: inputWithoutCacheWrite,
      cacheWriteTokens,
      cacheReadTokens,
      outputTokens,
      totalTokens,
      costUsd: parseMoney(pickFirst(row, ["Cost to you", "Cost"])),
    });
  });

  events.sort((a, b) => {
    const left = a.timestampMs ?? 0;
    const right = b.timestampMs ?? 0;
    return left - right;
  });
  return events;
}

function parseCursorDate(
  value: string,
  timezone: string,
): { localDate: string; isoTimestamp: string; timestampMs: number | null } {
  if (value.includes("T")) {
    const parsed = DateTime.fromISO(value, { zone: "utc" });
    if (!parsed.isValid) {
      throw new Error(`Invalid Cursor timestamp: ${value}`);
    }
    return {
      localDate: parsed.setZone(timezone).toISODate() || value.slice(0, 10),
      isoTimestamp: parsed.toUTC().toISO() || value,
      timestampMs: parsed.toMillis(),
    };
  }

  const parsed = DateTime.fromISO(value, { zone: timezone });
  if (!parsed.isValid) {
    throw new Error(`Invalid Cursor date: ${value}`);
  }
  return {
    localDate: parsed.toISODate() || value,
    isoTimestamp: `${parsed.toISODate()}T00:00:00`,
    timestampMs: null,
  };
}

function pickFirst(row: Record<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export function cursorEventRowsForCsv(events: CursorUsageEvent[]): Array<Record<string, string | number | null>> {
  return events.map((event) => ({
    source: event.source,
    local_date: event.localDate,
    iso_timestamp: event.isoTimestamp,
    request_id: event.requestId,
    model: event.model,
    kind: event.kind,
    max_mode: event.maxMode,
    input_tokens: event.inputTokens,
    cache_write_tokens: event.cacheWriteTokens,
    cache_read_tokens: event.cacheReadTokens,
    output_tokens: event.outputTokens,
    total_tokens: event.totalTokens,
    cost_usd: event.costUsd,
  }));
}

export function addCursorDailyValues(
  target: DailyUsageRow,
  events: CursorUsageEvent[],
  date: string,
): void {
  const matching = events.filter((event) => event.localDate === date);
  if (matching.length === 0) {
    return;
  }

  target.cursorRequestCount = matching.length;
  for (const event of matching) {
    target.cursorInputTokens += event.inputTokens;
    target.cursorCacheWriteTokens += event.cacheWriteTokens;
    target.cursorCacheReadTokens += event.cacheReadTokens;
    target.cursorOutputTokens += event.outputTokens;
    target.cursorTotalTokens += event.totalTokens;
    target.cursorCostUsd += event.costUsd;
  }
}
