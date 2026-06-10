import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { DateTime } from "luxon";
import type { CodexUsageEvent } from "./types.js";
import { isDateInRange, parseInteger } from "./util.js";

interface ClaudeCodeParseOptions {
  /** Claude Code 数据根目录，默认 ~/.claude */
  claudeRoot?: string;
  timezone: string;
  from: string;
  to: string;
}

/** Claude Code 会话 JSONL 中带用量的 assistant 行的最小结构 */
interface ClaudeLogEntry {
  type?: string;
  timestamp?: string;
  requestId?: string;
  message?: {
    id?: string;
    model?: string;
    usage?: {
      input_tokens?: unknown;
      cache_creation_input_tokens?: unknown;
      cache_read_input_tokens?: unknown;
      output_tokens?: unknown;
    };
  };
}

/**
 * 解析 Claude Code 本地会话记录（~/.claude/projects/<项目>/<会话>.jsonl），
 * 产出与 Codex 同构的用量事件（source = "claude-code"），复用既有日聚合/定价管道。
 */
export async function loadClaudeCodeEvents(options: ClaudeCodeParseOptions): Promise<CodexUsageEvent[]> {
  const projectsDir = path.join(options.claudeRoot || path.join(os.homedir(), ".claude"), "projects");
  const files = await collectJsonlFiles(projectsDir);
  const events: CodexUsageEvent[] = [];
  // 同一条 assistant 消息可能因流式续写在文件里出现多行，用 message.id + requestId 去重
  const seen = new Set<string>();

  for (const filePath of files) {
    events.push(...(await parseClaudeSessionFile(filePath, projectsDir, options, seen)));
  }

  events.sort((a, b) => a.timestampMs - b.timestampMs);
  return events;
}

async function collectJsonlFiles(dirPath: string): Promise<string[]> {
  const entries = await safeReadDir(dirPath);
  const results: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await collectJsonlFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      results.push(fullPath);
    }
  }

  return results;
}

async function safeReadDir(dirPath: string): Promise<fs.Dirent[]> {
  try {
    return await fsp.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function parseClaudeSessionFile(
  filePath: string,
  projectsDir: string,
  options: ClaudeCodeParseOptions,
  seen: Set<string>,
): Promise<CodexUsageEvent[]> {
  const input = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const events: CodexUsageEvent[] = [];
  const sessionId = path.relative(projectsDir, filePath).replace(/\\/g, "/").replace(/\.jsonl$/i, "");

  for await (const line of rl) {
    // 只有 assistant 消息行才带 usage，先做廉价字符串预筛再 JSON.parse
    if (!line.includes('"usage"')) {
      continue;
    }

    let entry: ClaudeLogEntry;
    try {
      entry = JSON.parse(line) as ClaudeLogEntry;
    } catch {
      continue;
    }

    const usage = entry.message?.usage;
    if (entry.type !== "assistant" || !usage) {
      continue;
    }

    // 跨行去重：同一 API 响应（message.id + requestId）只记一次
    const dedupeKey = `${entry.message?.id ?? ""}:${entry.requestId ?? ""}`;
    if (dedupeKey !== ":") {
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
    }

    const timestamp = entry.timestamp ? DateTime.fromISO(entry.timestamp, { zone: "utc" }) : null;
    if (!timestamp || !timestamp.isValid) {
      continue;
    }

    const localDate = timestamp.setZone(options.timezone).toISODate();
    if (!localDate || !isDateInRange(localDate, options.from, options.to)) {
      continue;
    }

    // 计费口径对齐 Codex 字段：cache 写入算输入、cache 读取算缓存输入；Claude 无独立 reasoning 计数
    const inputTokens = parseInteger(usage.input_tokens) + parseInteger(usage.cache_creation_input_tokens);
    const cachedInputTokens = parseInteger(usage.cache_read_input_tokens);
    const outputTokens = parseInteger(usage.output_tokens);
    const totalTokens = inputTokens + cachedInputTokens + outputTokens;

    if (totalTokens === 0) {
      continue;
    }

    events.push({
      source: "claude-code",
      sessionId,
      sessionPath: filePath,
      timestampMs: timestamp.toMillis(),
      isoTimestamp: timestamp.toUTC().toISO() || entry.timestamp || "",
      localDate,
      model: typeof entry.message?.model === "string" && entry.message.model.trim() ? entry.message.model.trim() : null,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      reasoningOutputTokens: 0,
      totalTokens,
    });
  }

  return events;
}
