import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DateTime } from "luxon";

export function defaultTimezone(): string {
  return process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function todayInZone(timezone: string): string {
  return DateTime.now().setZone(timezone).toISODate() || DateTime.now().toISODate() || "1970-01-01";
}

export function startOfMonthInZone(timezone: string): string {
  return (
    DateTime.now().setZone(timezone).startOf("month").toISODate() ||
    DateTime.now().startOf("month").toISODate() ||
    "1970-01-01"
  );
}

export function oneYearAgoInZone(timezone: string): string {
  return (
    DateTime.now().setZone(timezone).minus({ years: 1 }).toISODate() ||
    DateTime.now().minus({ years: 1 }).toISODate() ||
    "1970-01-01"
  );
}

export function homeDir(): string {
  return os.homedir();
}

export function resolveDefaultCodexRoot(): string {
  const envRoot = process.env.CODEX_HOME?.split(",")[0]?.trim();
  if (envRoot) {
    return envRoot;
  }
  return path.join(homeDir(), ".codex");
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export function compareIsoDate(a: string, b: string): number {
  return a.localeCompare(b);
}

export function isDateInRange(date: string, from: string, to: string): boolean {
  return compareIsoDate(date, from) >= 0 && compareIsoDate(date, to) <= 0;
}

export function parseIsoDateOrThrow(value: string, flagName: string): string {
  const parsed = DateTime.fromISO(value, { zone: "utc" });
  if (!parsed.isValid || value.length !== 10) {
    throw new Error(`Invalid ${flagName}: ${value}. Expected YYYY-MM-DD.`);
  }
  return value;
}

export function zonedDateRangeToUtcMillis(
  from: string,
  to: string,
  timezone: string,
): { startMs: number; endMs: number } {
  const start = DateTime.fromISO(from, { zone: timezone }).startOf("day");
  const end = DateTime.fromISO(to, { zone: timezone }).endOf("day");
  if (!start.isValid || !end.isValid) {
    throw new Error(`Invalid date range: ${from} .. ${to}`);
  }
  return {
    startMs: start.toUTC().toMillis(),
    endMs: end.toUTC().toMillis(),
  };
}

export function toLocalDateFromUtcMillis(timestampMs: number, timezone: string): string {
  const value = DateTime.fromMillis(timestampMs, { zone: "utc" }).setZone(timezone).toISODate();
  if (!value) {
    throw new Error(`Could not convert timestamp ${timestampMs} to local date`);
  }
  return value;
}

export function parseInteger(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === "string") {
    const normalized = value.trim().replace(/,/g, "");
    if (!normalized) {
      return 0;
    }
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.trunc(parsed));
    }
  }
  return 0;
}

export function parseMoney(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().replace(/\$/g, "").replace(/,/g, "");
    if (!normalized || normalized.toLowerCase() === "included") {
      return 0;
    }
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

export function formatInt(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function csvEscape(value: string | number | null): string {
  if (value == null) {
    return "";
  }
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

export function toCsv<T extends Record<string, string | number | null>>(
  rows: T[],
  columns: string[],
): string {
  const header = columns.join(",");
  const lines = rows.map((row) => columns.map((column) => csvEscape(row[column] ?? "")).join(","));
  return [header, ...lines].join("\n");
}

export function readJwtExpiryIso(jwt: string): string | null {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) {
      return null;
    }
    const payloadJson = Buffer.from(parts[1]!, "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson) as { exp?: number };
    if (typeof payload.exp !== "number") {
      return null;
    }
    return DateTime.fromSeconds(payload.exp, { zone: "utc" }).toISO();
  } catch {
    return null;
  }
}
