import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { ClaudeUsageLimits, CodexUsageLimits, CursorUsageLimits, UsageLimitsSnapshot, UsageLimitWindow } from "./contracts.js";
import { loadClaudeCodeEvents } from "./claude-code.js";
import { resolveCursorAuth } from "./cursor.js";
import { defaultTimezone, resolveDefaultCodexRoot } from "./util.js";

const CODEX_REFRESH_ENDPOINT = "https://auth.openai.com/oauth/token";
const CODEX_WHAM_URL = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_SESSION_WINDOW_SECONDS = 18_000;
const CODEX_WEEKLY_WINDOW_SECONDS = 604_800;
const CODEX_REFRESH_THRESHOLD_MS = 8 * 24 * 60 * 60 * 1000;
const CURSOR_SUMMARY_URL = "https://cursor.com/api/usage-summary";
const CURSOR_LEGACY_REQUEST_LIMIT = 500;
const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_OAUTH_BETA = "oauth-2025-04-20";
const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials";
const CLAUDE_SESSION_WINDOW_SECONDS = 18_000;
const CLAUDE_WEEKLY_WINDOW_SECONDS = 604_800;

const execFileAsync = promisify(execFile);

interface CodexAuthJson {
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    id_token?: string;
    account_id?: string;
  };
  last_refresh?: string;
}

interface CodexAuthBundle {
  accessToken: string;
  refreshToken: string | null;
  accountId: string | null;
  planType: string | null;
  authPath: string;
  authJson: CodexAuthJson;
  lastRefresh: string | null;
}

function clampPercent(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  if (numeric <= 0) {
    return 0;
  }
  if (numeric >= 100) {
    return 100;
  }
  return numeric;
}

function buildWindow(params: {
  usedPercent: unknown;
  resetAt: string | number | null | undefined;
  limitWindowSeconds?: unknown;
}): UsageLimitWindow | null {
  const usedPercent = clampPercent(params.usedPercent);
  if (usedPercent === null) {
    return null;
  }

  return {
    usedPercent,
    resetAt: params.resetAt ?? null,
    limitWindowSeconds:
      typeof params.limitWindowSeconds === "number" && Number.isFinite(params.limitWindowSeconds)
        ? params.limitWindowSeconds
        : null,
  };
}

function decodeJwtPayload(token: string | undefined): Record<string, unknown> | null {
  if (!token) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getOpenAiAuthNamespace(payload: Record<string, unknown> | null): Record<string, unknown> | null {
  const value = payload?.["https://api.openai.com/auth"];
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function readCodexAuthBundle(codexRoot = resolveDefaultCodexRoot()): Promise<CodexAuthBundle | null> {
  try {
    const authPath = path.join(codexRoot, "auth.json");
    const auth = JSON.parse(await fs.readFile(authPath, "utf8")) as CodexAuthJson;
    const accessToken = normalizeString(auth.tokens?.access_token);
    if (!accessToken) {
      return null;
    }

    const accessPayload = decodeJwtPayload(auth.tokens?.access_token);
    const idPayload = decodeJwtPayload(auth.tokens?.id_token);
    const accessNs = getOpenAiAuthNamespace(accessPayload);
    const idNs = getOpenAiAuthNamespace(idPayload);

    const accountId =
      normalizeString(auth.tokens?.account_id) ??
      normalizeString(accessNs?.chatgpt_account_id) ??
      normalizeString(idNs?.chatgpt_account_id);
    const planType =
      normalizeString(accessNs?.chatgpt_plan_type)?.toLowerCase() ??
      normalizeString(idNs?.chatgpt_plan_type)?.toLowerCase() ??
      null;

    return {
      accessToken,
      refreshToken: normalizeString(auth.tokens?.refresh_token),
      accountId,
      planType,
      authPath,
      authJson: auth,
      lastRefresh: normalizeString(auth.last_refresh),
    };
  } catch {
    return null;
  }
}

function isCodexTokenStale(lastRefresh: string | null, nowMs = Date.now()) {
  if (!lastRefresh) {
    return true;
  }

  const parsed = Date.parse(lastRefresh);
  if (!Number.isFinite(parsed)) {
    return true;
  }

  return nowMs - parsed > CODEX_REFRESH_THRESHOLD_MS;
}

async function refreshCodexTokens(refreshToken: string) {
  const response = await fetch(CODEX_REFRESH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: CODEX_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: "openid profile email",
    }),
  });

  if (response.status === 401) {
    throw new Error("Codex refresh token expired. Run codex again to re-authenticate.");
  }
  if (!response.ok) {
    throw new Error(`Codex token refresh failed: ${response.status}`);
  }

  const body = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    id_token?: string | null;
  };
  if (!body.access_token) {
    throw new Error("Codex token refresh response missing access_token.");
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token || refreshToken,
    idToken: body.id_token || null,
  };
}

async function persistRefreshedCodexAuth(bundle: CodexAuthBundle, refreshed: {
  accessToken: string;
  refreshToken: string;
  idToken: string | null;
}) {
  const nextAuth: CodexAuthJson = {
    ...bundle.authJson,
    tokens: {
      ...(bundle.authJson.tokens || {}),
      access_token: refreshed.accessToken,
      refresh_token: refreshed.refreshToken,
      id_token: refreshed.idToken || bundle.authJson.tokens?.id_token,
      account_id: bundle.authJson.tokens?.account_id,
    },
    last_refresh: new Date().toISOString(),
  };

  await fs.writeFile(bundle.authPath, JSON.stringify(nextAuth, null, 2), "utf8");
  return readCodexAuthBundle(path.dirname(bundle.authPath));
}

function classifyCodexWindow(window: Record<string, unknown> | null): "session" | "weekly" | null {
  if (!window) {
    return null;
  }

  const seconds = Number(window.limit_window_seconds);
  if (!Number.isFinite(seconds)) {
    return null;
  }
  if (seconds === CODEX_SESSION_WINDOW_SECONDS) {
    return "session";
  }
  if (seconds === CODEX_WEEKLY_WINDOW_SECONDS) {
    return "weekly";
  }
  return null;
}

function normalizeCodexRateWindows(rateLimit: Record<string, unknown>) {
  const candidates = [rateLimit.primary_window, rateLimit.secondary_window].filter(
    (window): window is Record<string, unknown> => Boolean(window && typeof window === "object"),
  );

  let session: Record<string, unknown> | null = null;
  let weekly: Record<string, unknown> | null = null;

  for (const candidate of candidates) {
    const kind = classifyCodexWindow(candidate);
    if (kind === "session" && !session) {
      session = candidate;
    } else if (kind === "weekly" && !weekly) {
      weekly = candidate;
    }
  }

  if (!session && !weekly && candidates.length > 0) {
    return {
      primaryWindow: buildWindow({
        usedPercent: candidates[0]?.used_percent,
        resetAt: (candidates[0]?.reset_at as string | number | null | undefined) ?? null,
        limitWindowSeconds: candidates[0]?.limit_window_seconds,
      }),
      secondaryWindow: buildWindow({
        usedPercent: candidates[1]?.used_percent,
        resetAt: (candidates[1]?.reset_at as string | number | null | undefined) ?? null,
        limitWindowSeconds: candidates[1]?.limit_window_seconds,
      }),
    };
  }

  return {
    primaryWindow: buildWindow({
      usedPercent: session?.used_percent,
      resetAt: (session?.reset_at as string | number | null | undefined) ?? null,
      limitWindowSeconds: session?.limit_window_seconds,
    }),
    secondaryWindow: buildWindow({
      usedPercent: weekly?.used_percent,
      resetAt: (weekly?.reset_at as string | number | null | undefined) ?? null,
      limitWindowSeconds: weekly?.limit_window_seconds,
    }),
  };
}

async function fetchCodexUsageLimits(): Promise<CodexUsageLimits> {
  let bundle = await readCodexAuthBundle();
  if (!bundle) {
    return {
      configured: false,
      error: null,
      planType: null,
      primaryWindow: null,
      secondaryWindow: null,
    };
  }

  if (bundle.refreshToken && isCodexTokenStale(bundle.lastRefresh)) {
    try {
      const refreshed = await refreshCodexTokens(bundle.refreshToken);
      const updatedBundle = await persistRefreshedCodexAuth(bundle, refreshed);
      if (updatedBundle) {
        bundle = updatedBundle;
      }
    } catch (error) {
      return {
        configured: true,
        error: error instanceof Error ? error.message : String(error),
        planType: bundle.planType,
        primaryWindow: null,
        secondaryWindow: null,
      };
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${bundle.accessToken}`,
    Accept: "application/json",
  };
  if (bundle.accountId) {
    headers["ChatGPT-Account-Id"] = bundle.accountId;
  }

  const response = await fetch(CODEX_WHAM_URL, { method: "GET", headers });
  if ([401, 403, 404].includes(response.status)) {
    return {
      configured: true,
      error: null,
      planType: bundle.planType,
      primaryWindow: null,
      secondaryWindow: null,
    };
  }
  if (!response.ok) {
    return {
      configured: true,
      error: `Codex API returned ${response.status}`,
      planType: bundle.planType,
      primaryWindow: null,
      secondaryWindow: null,
    };
  }

  const body = (await response.json()) as { rate_limit?: Record<string, unknown> };
  const normalized = normalizeCodexRateWindows(body.rate_limit || {});
  return {
    configured: true,
    error: null,
    planType: bundle.planType,
    primaryWindow: normalized.primaryWindow,
    secondaryWindow: normalized.secondaryWindow,
  };
}

async function fetchCursorUsageLimits(): Promise<CursorUsageLimits> {
  let auth;
  try {
    auth = resolveCursorAuth({
      timezone: defaultTimezone(),
      from: "1970-01-01",
      to: "1970-01-01",
    });
  } catch {
    return {
      configured: false,
      error: null,
      membershipType: null,
      primaryWindow: null,
      secondaryWindow: null,
      tertiaryWindow: null,
      requestLimit: CURSOR_LEGACY_REQUEST_LIMIT,
      rawPlanUsed: null,
      rawPlanLimit: null,
      rawPlanRemaining: null,
    };
  }

  const response = await fetch(CURSOR_SUMMARY_URL, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Cookie: auth.cookieHeader,
      Referer: "https://www.cursor.com/settings",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });

  if (response.status === 401 || response.status === 403) {
    return {
      configured: true,
      error: "Cursor session expired. Re-login in Cursor to refresh usage.",
      membershipType: null,
      primaryWindow: null,
      secondaryWindow: null,
      tertiaryWindow: null,
      requestLimit: CURSOR_LEGACY_REQUEST_LIMIT,
      rawPlanUsed: null,
      rawPlanLimit: null,
      rawPlanRemaining: null,
    };
  }
  if (!response.ok) {
    return {
      configured: true,
      error: `Cursor API returned ${response.status}`,
      membershipType: null,
      primaryWindow: null,
      secondaryWindow: null,
      tertiaryWindow: null,
      requestLimit: CURSOR_LEGACY_REQUEST_LIMIT,
      rawPlanUsed: null,
      rawPlanLimit: null,
      rawPlanRemaining: null,
    };
  }

  const body = (await response.json()) as Record<string, unknown>;
  const plan = (body.individualUsage as Record<string, unknown> | undefined)?.plan as Record<string, unknown> | null;
  const individualOnDemand = (body.individualUsage as Record<string, unknown> | undefined)?.onDemand as Record<string, unknown> | null;
  const teamOnDemand = (body.teamUsage as Record<string, unknown> | undefined)?.onDemand as Record<string, unknown> | null;
  const billingCycleEnd = normalizeString(body.billingCycleEnd);
  const autoPercent = clampPercent(plan?.autoPercentUsed);
  const apiPercent = clampPercent(plan?.apiPercentUsed);

  let planPercent = clampPercent(plan?.totalPercentUsed);
  if (planPercent === null) {
    if (autoPercent !== null && apiPercent !== null) {
      planPercent = clampPercent((autoPercent + apiPercent) / 2);
    } else if (apiPercent !== null) {
      planPercent = apiPercent;
    } else if (autoPercent !== null) {
      planPercent = autoPercent;
    } else {
      planPercent = clampPercent(percentFromUsedLimit(plan?.used, plan?.limit));
    }
  }

  if (planPercent === null) {
    planPercent = clampPercent(percentFromUsedLimit(individualOnDemand?.used, individualOnDemand?.limit));
  }
  if (planPercent === null) {
    planPercent = clampPercent(percentFromUsedLimit(teamOnDemand?.used, teamOnDemand?.limit));
  }

  return {
    configured: true,
    error: null,
    membershipType: normalizeString(body.membershipType),
    primaryWindow: buildWindow({ usedPercent: planPercent, resetAt: billingCycleEnd }),
    secondaryWindow: buildWindow({ usedPercent: autoPercent, resetAt: billingCycleEnd }),
    tertiaryWindow: buildWindow({ usedPercent: apiPercent, resetAt: billingCycleEnd }),
    requestLimit: CURSOR_LEGACY_REQUEST_LIMIT,
    rawPlanUsed: Number.isFinite(Number(plan?.used)) ? Number(plan?.used) : null,
    rawPlanLimit: Number.isFinite(Number(plan?.limit)) ? Number(plan?.limit) : null,
    rawPlanRemaining: Number.isFinite(Number(plan?.remaining)) ? Number(plan?.remaining) : null,
  };
}

function percentFromUsedLimit(usedRaw: unknown, limitRaw: unknown) {
  const used = Number(usedRaw);
  const limit = Number(limitRaw);
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) {
    return null;
  }
  return (used / limit) * 100;
}

/**
 * 读取 Claude Code 本机 OAuth 凭据中的 accessToken。
 * 优先读 ~/.claude/.credentials.json（Windows / Linux / 关闭钥匙串的 macOS），
 * macOS 默认存钥匙串（service = "Claude Code-credentials"），用 security CLI 读取。
 */
async function readClaudeAccessToken(): Promise<string | null> {
  const parseToken = (raw: string): string | null => {
    try {
      const parsed = JSON.parse(raw) as { claudeAiOauth?: { accessToken?: string } };
      return normalizeString(parsed.claudeAiOauth?.accessToken);
    } catch {
      return null;
    }
  };

  try {
    const raw = await fs.readFile(path.join(os.homedir(), ".claude", ".credentials.json"), "utf8");
    const token = parseToken(raw);
    if (token) {
      return token;
    }
  } catch {
    // 文件不存在则继续尝试钥匙串
  }

  if (process.platform === "darwin") {
    try {
      const { stdout } = await execFileAsync(
        "security",
        ["find-generic-password", "-s", CLAUDE_KEYCHAIN_SERVICE, "-w"],
        { timeout: 10_000 },
      );
      return parseToken(stdout.trim());
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * 查询 Claude Code 限额。
 * 优先调官方 OAuth usage 接口（与 Claude Code 内置 /usage 同源）；
 * 该接口目前对第三方客户端返回 403 "Request not allowed"，失败时回退本地估算：
 * 用 ~/.claude 会话日志计算 5 小时滚动窗口用量，占比以近 35 天观测到的最大 5 小时块为基准。
 */
async function fetchClaudeUsageLimits(): Promise<ClaudeUsageLimits> {
  const accessToken = await readClaudeAccessToken();
  if (!accessToken) {
    return {
      configured: false,
      error: "Claude Code auth not found",
      planType: null,
      primaryWindow: null,
      secondaryWindow: null,
    };
  }

  const response = await fetch(CLAUDE_USAGE_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "anthropic-beta": CLAUDE_OAUTH_BETA,
      "anthropic-version": "2023-06-01",
      Accept: "application/json",
    },
  });

  if (response.ok) {
    const body = (await response.json()) as Record<string, unknown>;
    const fiveHour = (body.five_hour ?? null) as Record<string, unknown> | null;
    const sevenDay = (body.seven_day ?? null) as Record<string, unknown> | null;
    return {
      configured: true,
      error: null,
      planType: normalizeString(body.subscription_type) ?? normalizeString(body.plan_type),
      primaryWindow: buildWindow({
        usedPercent: fiveHour?.utilization,
        resetAt: (fiveHour?.resets_at as string | number | null | undefined) ?? null,
        limitWindowSeconds: CLAUDE_SESSION_WINDOW_SECONDS,
      }),
      secondaryWindow: buildWindow({
        usedPercent: sevenDay?.utilization,
        resetAt: (sevenDay?.resets_at as string | number | null | undefined) ?? null,
        limitWindowSeconds: CLAUDE_WEEKLY_WINDOW_SECONDS,
      }),
    };
  }

  // 官方接口不可用（403 等）→ 本地估算兜底
  return estimateClaudeLimitsLocally();
}

/**
 * 本地估算 Claude Code 5 小时窗口用量：
 * - 当前窗口用量 = 最近 5 小时内的 token 合计；重置时间 = 当前活跃块首条消息所在整点 + 5h
 * - 占比基准 = 近 35 天内观测到的最大 5 小时滑动窗口用量（近似个人额度上限）
 */
async function estimateClaudeLimitsLocally(): Promise<ClaudeUsageLimits> {
  const timezone = defaultTimezone();
  const now = Date.now();
  const toDate = new Date(now);
  const fromDate = new Date(now - 35 * 24 * 60 * 60 * 1000);
  const toIso = toDate.toISOString().slice(0, 10);
  const fromIso = fromDate.toISOString().slice(0, 10);

  const events = await loadClaudeCodeEvents({ timezone, from: fromIso, to: toIso });
  const windowMs = CLAUDE_SESSION_WINDOW_SECONDS * 1000;

  // 当前 5 小时窗口内的事件与用量
  const currentEvents = events.filter((event) => event.timestampMs > now - windowMs);
  const currentTokens = currentEvents.reduce((sum, event) => sum + event.totalTokens, 0);

  // 滑动窗口扫描历史最大 5 小时块（双指针，事件已按时间升序）
  let maxWindowTokens = 0;
  let windowSum = 0;
  let left = 0;
  for (let right = 0; right < events.length; right += 1) {
    windowSum += events[right]!.totalTokens;
    while (events[right]!.timestampMs - events[left]!.timestampMs > windowMs) {
      windowSum -= events[left]!.totalTokens;
      left += 1;
    }
    maxWindowTokens = Math.max(maxWindowTokens, windowSum);
  }

  // 重置时间：当前活跃块从首条消息所在整点起算，持续 5 小时
  const firstCurrent = currentEvents[0];
  const resetAt = firstCurrent
    ? new Date(Math.floor(firstCurrent.timestampMs / 3_600_000) * 3_600_000 + windowMs).toISOString()
    : null;

  const usedPercent = maxWindowTokens > 0 ? (currentTokens / maxWindowTokens) * 100 : 0;

  return {
    configured: true,
    error: null,
    // note 槽位展示估算口径，提示这不是官方百分比
    planType: "local est.",
    primaryWindow: buildWindow({
      usedPercent,
      resetAt,
      limitWindowSeconds: CLAUDE_SESSION_WINDOW_SECONDS,
    }),
    secondaryWindow: null,
  };
}

export async function getUsageLimitsSnapshot(): Promise<UsageLimitsSnapshot> {
  const [codexResult, cursorResult, claudeResult] = await Promise.allSettled([
    fetchCodexUsageLimits(),
    fetchCursorUsageLimits(),
    fetchClaudeUsageLimits(),
  ]);
  const codex =
    codexResult.status === "fulfilled"
      ? codexResult.value
      : {
          configured: true,
          error: codexResult.reason instanceof Error ? codexResult.reason.message : String(codexResult.reason),
          planType: null,
          primaryWindow: null,
          secondaryWindow: null,
        };
  const cursor =
    cursorResult.status === "fulfilled"
      ? cursorResult.value
      : {
          configured: true,
          error: cursorResult.reason instanceof Error ? cursorResult.reason.message : String(cursorResult.reason),
          membershipType: null,
          primaryWindow: null,
          secondaryWindow: null,
          tertiaryWindow: null,
          requestLimit: CURSOR_LEGACY_REQUEST_LIMIT,
          rawPlanUsed: null,
          rawPlanLimit: null,
          rawPlanRemaining: null,
        };

  const claude =
    claudeResult.status === "fulfilled"
      ? claudeResult.value
      : {
          configured: true,
          error: claudeResult.reason instanceof Error ? claudeResult.reason.message : String(claudeResult.reason),
          planType: null,
          primaryWindow: null,
          secondaryWindow: null,
        };

  return {
    fetchedAt: new Date().toISOString(),
    codex,
    cursor,
    claude,
  };
}
