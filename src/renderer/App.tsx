import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { AppDefaults, AppReportOptions, GenerateReportResult, ModelUsageEntry, UsageLimitsSnapshot } from "../contracts.js";
import type { DailyUsageRow } from "../types.js";
import { getTokenMonitorBridge } from "./bridge.js";
import { CZLogo } from "./CZLogo.js";

const bridge = getTokenMonitorBridge();

const CURSOR_USAGE_URL = "https://cursor.com/dashboard/usage";
const GAMMA_HOME_URL = "https://gamma.app/";
const MANUS_HOME_URL = "https://manus.im/";
const CHATGPT_WEB_URL = "https://chatgpt.com/";
const GEMINI_WEB_URL = "https://gemini.google.com/";
const STITCH_WEB_URL = "https://stitch.withgoogle.com/";

const HEATMAP_LEVELS = 6;

export function App() {
  const [defaults, setDefaults] = useState<AppDefaults | null>(null);
  const [report, setReport] = useState<GenerateReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usageLimits, setUsageLimits] = useState<UsageLimitsSnapshot | null>(null);
  const [usageLimitsError, setUsageLimitsError] = useState<string | null>(null);
  const [autoloaded, setAutoloaded] = useState(false);
  const dateFrom = defaults?.from ?? "";
  const dateTo = defaults?.to ?? "";

  useEffect(() => {
    void bridge.getDefaults().then((value) => {
      setDefaults(value);
    });
    void loadUsageLimits();
  }, []);

  const appOptions = useMemo<AppReportOptions | null>(() => {
    if (!defaults || !dateFrom || !dateTo) {
      return null;
    }
    return createReportOptions(defaults, dateFrom, dateTo);
  }, [defaults, dateFrom, dateTo]);

  useEffect(() => {
    if (!appOptions || autoloaded) {
      return;
    }
    setAutoloaded(true);
    void runReport(appOptions);
  }, [appOptions, autoloaded]);

  useEffect(() => {
    if (!defaults || !dateFrom || !dateTo) {
      return;
    }

    const syncOnFocus = () => {
      void syncDefaultsAndMaybeRefresh(false);
      void loadUsageLimits();
    };
    const syncOnVisible = () => {
      if (document.visibilityState === "visible") {
        void syncDefaultsAndMaybeRefresh(false);
        void loadUsageLimits();
      }
    };
    const timer = window.setInterval(() => {
      void syncDefaultsAndMaybeRefresh(false);
      void loadUsageLimits();
    }, 60_000);

    window.addEventListener("focus", syncOnFocus);
    document.addEventListener("visibilitychange", syncOnVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", syncOnFocus);
      document.removeEventListener("visibilitychange", syncOnVisible);
    };
  }, [defaults, dateFrom, dateTo]);

  async function runReport(options: AppReportOptions) {
    setLoading(true);
    setError(null);
    try {
      setReport(await bridge.runReport(options));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadUsageLimits() {
    try {
      setUsageLimits(await bridge.getUsageLimits());
      setUsageLimitsError(null);
    } catch (err) {
      setUsageLimitsError(err instanceof Error ? err.message : String(err));
    }
  }

  async function syncDefaultsAndMaybeRefresh(forceRefresh: boolean) {
    const nextDefaults = await bridge.getDefaults();
    const defaultsChanged =
      !defaults ||
      nextDefaults.from !== defaults.from ||
      nextDefaults.to !== defaults.to ||
      nextDefaults.timezone !== defaults.timezone ||
      nextDefaults.codexRoot !== defaults.codexRoot ||
      nextDefaults.outDir !== defaults.outDir ||
      nextDefaults.cursorAppDir !== defaults.cursorAppDir ||
      nextDefaults.cursorCliConfigPath !== defaults.cursorCliConfigPath;

    if (defaultsChanged) {
      setDefaults(nextDefaults);
    }
    if (forceRefresh || defaultsChanged) {
      await runReport(createReportOptions(nextDefaults, nextDefaults.from, nextDefaults.to));
    }
  }

  const today = dateTo || toIsoDate(new Date());
  const todayData = report?.rows.find((row) => row.date === today);
  const monthKey = today.slice(0, 7);
  const monthRows = (report?.rows ?? []).filter((row) => row.date.startsWith(monthKey));
  const monthTokens = monthRows.reduce((sum, row) => sum + row.combinedTotalTokens, 0);
  const monthCost = monthRows.reduce((sum, row) => sum + row.combinedEstimatedCostUsd, 0);
  const todayTokens = todayData?.combinedTotalTokens ?? 0;
  const todayCost = todayData?.combinedEstimatedCostUsd ?? 0;

  const todayCodexTokens = todayData?.codexTotalTokens ?? 0;
  const todayCursorTokens = todayData?.cursorTotalTokens ?? 0;
  const monthCodexTokens = monthRows.reduce((sum, row) => sum + row.codexTotalTokens, 0);
  const monthCursorTokens = monthRows.reduce((sum, row) => sum + row.cursorTotalTokens, 0);
  const todayCodexCost = todayData?.codexEstimatedCostUsd ?? 0;
  const todayCursorCost = todayData?.cursorEstimatedCostUsd ?? 0;
  const monthCodexCost = monthRows.reduce((sum, row) => sum + row.codexEstimatedCostUsd, 0);
  const monthCursorCost = monthRows.reduce((sum, row) => sum + row.cursorEstimatedCostUsd, 0);

  return (
    <div className="app-shell">
      <main className="page">
        {bridge.mode === "preview" && <div className="message message-preview">Preview mode</div>}

        <header className="topbar">
          <div className="topbar-left">
            <div className="brand-lockup">
              <CZLogo className="app-logo" />
              <span className="app-wordmark">Tokn</span>
            </div>
          </div>
          <div className="topbar-right">
            <button
              className={`btn-refresh${loading ? " btn-refresh-loading" : ""}`}
              onClick={() => {
                if (dateFrom && dateTo) {
                  void syncDefaultsAndMaybeRefresh(true);
                }
                void loadUsageLimits();
              }}
              disabled={!appOptions || loading}
              aria-label={loading ? "Refreshing" : "Refresh"}
              title={loading ? "Refreshing" : "Refresh"}
              type="button"
            >
              {"\u21BB"}
            </button>
          </div>
        </header>

        {error && <div className="message message-error">{error}</div>}
        <ReportWarnings warnings={report?.warnings ?? []} />

        {!report ? (
          <LoadingSkeleton />
        ) : (
          <>
            <section className="kpi-row">
              <KpiCard
                label="Today Tokens"
                value={fmtCompact(todayTokens)}
                sub={fmtNum(todayTokens)}
                sub2={fmtChineseLarge(todayTokens)}
              />
              <KpiCard
                label="Month Tokens"
                value={fmtCompact(monthTokens)}
                sub={fmtNum(monthTokens)}
                sub2={fmtChineseLarge(monthTokens)}
              />
              <KpiCard label="Today Cost" value={fmtUsd(todayCost)} />
              <KpiCard label="Month Cost" value={fmtUsd(monthCost)} />
            </section>

            <section className="panel">
              <div className="panel-top panel-top-activity">
                <h2>Activity</h2>
              </div>
              <CalendarHeatmap rows={report.rows} />
            </section>

            <section className="panel panel-usage-surface">
              <UsageLimitsBoard
                limits={usageLimits}
                error={usageLimitsError}
                codexUsage={{
                  todayTokens: todayCodexTokens,
                  todayCost: todayCodexCost,
                  monthTokens: monthCodexTokens,
                  monthCost: monthCodexCost,
                }}
                cursorUsage={{
                  todayTokens: todayCursorTokens,
                  todayCost: todayCursorCost,
                  monthTokens: monthCursorTokens,
                  monthCost: monthCursorCost,
                }}
              />
            </section>

            <section className="panel panel-aux">
              <div className="panel-top panel-top-stack">
                <div>
                  <h2>Model Usage</h2>
                  <p className="panel-note">
                    Aggregated total usage for the current date range: {dateFrom} to {dateTo}. Showing top 5 models by
                    token volume by default. Estimated total cost per model is shown at the right.
                  </p>
                </div>
              </div>
              <ModelChart models={report.modelUsage} />
            </section>

            <section className="panel panel-aux">
              <h2>Daily Ledger</h2>
              <DataTable rows={report.rows} />
            </section>
          </>
        )}
      </main>
    </div>
  );
}

export function ReportWarnings({ warnings }: { warnings: GenerateReportResult["warnings"] }) {
  return <>{warnings.map((warning) => (
    <div className="message message-warning" role="status" key={warning.source}>
      <strong>{warning.source === "cursor" ? "Cursor" : "Codex"} usage unavailable. </strong>
      {warning.message} Totals exclude {warning.source === "cursor" ? "Cursor" : "Codex"} until it reconnects.
    </div>
  ))}</>;
}

function LoadingSkeleton() {
  return (
    <div className="skeleton-shell" aria-hidden="true">
      <section className="kpi-row skeleton-kpi-row">
        {Array.from({ length: 4 }, (_, index) => (
          <article key={index} className="kpi-card skeleton-kpi-card">
            <span className="skeleton-block skeleton-label" />
            <span className="skeleton-block skeleton-value" />
            <span className="skeleton-block skeleton-sub" />
          </article>
        ))}
      </section>

      <section className="panel skeleton-panel">
        <div className="panel-top panel-top-activity">
          <span className="skeleton-block skeleton-heading" />
        </div>
        <div className="skeleton-heatmap">
          <span className="skeleton-block skeleton-heatmap-strip" />
          <span className="skeleton-block skeleton-heatmap-strip" />
          <span className="skeleton-block skeleton-heatmap-strip" />
        </div>
      </section>

      <section className="panel panel-usage-surface skeleton-usage-panel">
        <div className="usage-limits-grid">
          <div className="usage-provider-card skeleton-usage-card">
            <div className="usage-provider-head">
              <span className="skeleton-block skeleton-logo" />
              <span className="skeleton-block skeleton-note" />
            </div>
            <div className="usage-limit-list">
              <div className="usage-limit-row">
                <span className="skeleton-block skeleton-mini-label" />
                <span className="skeleton-block skeleton-mini-bar" />
                <span className="skeleton-block skeleton-mini-number" />
                <span className="skeleton-block skeleton-mini-meta" />
              </div>
              <div className="usage-limit-row">
                <span className="skeleton-block skeleton-mini-label" />
                <span className="skeleton-block skeleton-mini-bar" />
                <span className="skeleton-block skeleton-mini-number" />
                <span className="skeleton-block skeleton-mini-meta" />
              </div>
            </div>
          </div>

          <div className="usage-provider-card skeleton-usage-card">
            <div className="usage-provider-head">
              <span className="skeleton-block skeleton-logo" />
              <span className="skeleton-block skeleton-note" />
            </div>
            <div className="usage-limit-list">
              <div className="usage-limit-row">
                <span className="skeleton-block skeleton-mini-label" />
                <span className="skeleton-block skeleton-mini-bar" />
                <span className="skeleton-block skeleton-mini-number" />
                <span className="skeleton-block skeleton-mini-meta" />
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

interface ProviderUsageStats {
  todayTokens: number;
  todayCost: number;
  monthTokens: number;
  monthCost: number;
}

export function UsageLimitsBoard(props: {
  limits: UsageLimitsSnapshot | null;
  error: string | null;
  codexUsage?: ProviderUsageStats;
  cursorUsage?: ProviderUsageStats;
}) {
  return (
    <div className="usage-limits-stack">
      <div className="usage-limits-grid">
        <UsageProviderCard
          logoSrc="/brand-logos/codex.svg"
          logoAlt="Codex"
          note={null}
          status={buildCodexStatus(props.limits?.codex, props.error)}
          stats={props.codexUsage}
        >
          <UsageLimitRow label="5h" window={props.limits?.codex.primaryWindow ?? null} percentValue={getRemainingPercent(props.limits?.codex.primaryWindow ?? null)} />
          <UsageLimitRow label="Week" window={props.limits?.codex.secondaryWindow ?? null} percentValue={getRemainingPercent(props.limits?.codex.secondaryWindow ?? null)} />
        </UsageProviderCard>
        <UsageProviderCard
          logoSrc="/brand-logos/cursor.svg"
          logoAlt="Cursor"
          href={CURSOR_USAGE_URL}
          note={null}
          status={buildCursorStatus(props.limits?.cursor, props.error)}
          stats={props.cursorUsage}
        >
          <UsageLimitRow
            label="Month"
            window={props.limits?.cursor.primaryWindow ?? null}
            percentValue={getCursorRemainingPercent(props.limits?.cursor)}
          />
        </UsageProviderCard>
      </div>
      <div className="subscription-shortcuts">
        <button
          className="subscription-shortcut"
          onClick={() => {
            void bridge.launchLocal("claudeCode");
          }}
          type="button"
          aria-label="Open Claude Code"
          title="Claude Code"
        >
          <img className="subscription-shortcut-logo" src="/brand-logos/claude-code.svg" alt="Claude Code" />
        </button>
        <button
          className="subscription-shortcut"
          onClick={() => {
            void bridge.launchLocal("opencode");
          }}
          type="button"
          aria-label="Open OpenCode"
          title="OpenCode"
        >
          <img className="subscription-shortcut-logo" src="/brand-logos/opencode.svg" alt="OpenCode" />
        </button>
        <button
          className="subscription-shortcut"
          onClick={() => {
            void bridge.launchLocal("amp");
          }}
          type="button"
          aria-label="Open Amp"
          title="Amp"
        >
          <img className="subscription-shortcut-logo" src="/brand-logos/amp.svg" alt="Amp" />
        </button>
        <button
          className="subscription-shortcut"
          onClick={() => {
            void bridge.openExternal(GAMMA_HOME_URL);
          }}
          type="button"
          aria-label="Open Gamma"
          title="Gamma"
        >
          <img className="subscription-shortcut-logo" src="/brand-logos/gamma.svg" alt="Gamma" />
        </button>
        <button
          className="subscription-shortcut"
          onClick={() => {
            void bridge.openExternal(MANUS_HOME_URL);
          }}
          type="button"
          aria-label="Open Manus"
          title="Manus"
        >
          <img className="subscription-shortcut-logo" src="/brand-logos/manus.ico" alt="Manus" />
        </button>
        <button
          className="subscription-shortcut"
          onClick={() => {
            void bridge.openExternal(CHATGPT_WEB_URL);
          }}
          type="button"
          aria-label="Open ChatGPT Web"
          title="ChatGPT Web"
        >
          <img className="subscription-shortcut-logo" src="/brand-logos/chatgpt-web.png" alt="ChatGPT Web" />
        </button>
        <button
          className="subscription-shortcut"
          onClick={() => {
            void bridge.openExternal(GEMINI_WEB_URL);
          }}
          type="button"
          aria-label="Open Gemini Web"
          title="Gemini Web"
        >
          <img className="subscription-shortcut-logo" src="/brand-logos/gemini-web.png" alt="Gemini Web" />
        </button>
        <button
          className="subscription-shortcut"
          onClick={() => {
            void bridge.openExternal(STITCH_WEB_URL);
          }}
          type="button"
          aria-label="Open Stitch"
          title="Stitch"
        >
          <img className="subscription-shortcut-logo" src="/brand-logos/stitch.png" alt="Stitch" />
        </button>
      </div>
    </div>
  );
}

function UsageProviderCard(props: {
  logoSrc: string;
  logoAlt: string;
  href?: string;
  note: string | null;
  status: string | null;
  stats?: ProviderUsageStats;
  footer?: string | null;
  children: ReactNode;
}) {
  const isClickable = Boolean(props.href);
  return (
    <button
      className={`usage-provider-card${isClickable ? " usage-provider-card-clickable" : ""}`}
      onClick={() => {
        if (props.href) {
          void bridge.openExternal(props.href);
        }
      }}
      type="button"
    >
      <div className="usage-provider-head">
        <div className="usage-provider-brand">
          <img className="usage-provider-logo" src={props.logoSrc} alt={props.logoAlt} />
        </div>
        {props.stats ? (
          <div className="usage-provider-consumption">
            <div
              className="usage-consumption-row"
              title={`Today: ${fmtNum(props.stats.todayTokens)} tokens (${fmtChineseCompact(props.stats.todayTokens)}) · ${fmtUsd(props.stats.todayCost)}`}
            >
              <span className="usage-consumption-tag">Today</span>
              <span className="usage-consumption-tokens">{fmtCompact(props.stats.todayTokens)}</span>
              <span className="usage-consumption-cost">{fmtUsdCompact(props.stats.todayCost)}</span>
            </div>
          </div>
        ) : (
          <div className="usage-provider-consumption" />
        )}
        {props.note ? <span className="usage-provider-note">{props.note}</span> : null}
      </div>
      {props.status ? (
        <p className="usage-provider-status">{props.status}</p>
      ) : (
        <>
          <div className="usage-limit-list">{props.children}</div>
          {props.footer ? <p className="usage-provider-footer">{props.footer}</p> : null}
        </>
      )}
    </button>
  );
}

function UsageLimitRow(props: {
  label: string;
  window: UsageLimitsSnapshot["codex"]["primaryWindow"] | UsageLimitsSnapshot["cursor"]["primaryWindow"] | null;
  percentValue?: number | null;
}) {
  const remainingPercent = props.percentValue ?? getRemainingPercent(props.window);
  if (!props.window || remainingPercent === null) {
    return (
      <div className="usage-limit-row usage-limit-row-empty">
        <span className="usage-limit-label">{props.label}</span>
        <span className="usage-limit-empty">-</span>
      </div>
    );
  }

  return (
    <div className="usage-limit-row" title={`${props.label}: ${Math.round(remainingPercent)}% remaining`}>
      <span className="usage-limit-label">{props.label}</span>
      <div className="usage-limit-bar" role="progressbar" aria-label={`${props.label} remaining quota`}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(remainingPercent)}>
        <div
          className="usage-limit-bar-fill"
          style={{ width: `${remainingPercent}%` }}
        />
      </div>
      <span className="usage-limit-percent">{Math.round(remainingPercent)}%</span>
      <span className="usage-limit-reset">{formatResetAt(props.window.resetAt)}</span>
    </div>
  );
}

function buildCodexStatus(limits: UsageLimitsSnapshot["codex"] | undefined, sharedError: string | null) {
  if (!limits) {
    return sharedError ? `Unavailable: ${sharedError}` : "Loading...";
  }
  if (!limits.configured) {
    return "Codex auth not found";
  }
  return limits.error;
}

function buildCursorStatus(limits: UsageLimitsSnapshot["cursor"] | undefined, sharedError: string | null) {
  if (!limits) {
    return sharedError ? `Unavailable: ${sharedError}` : "Loading...";
  }
  if (!limits.configured) {
    return "Cursor auth not found";
  }
  return limits.error;
}

function getRemainingPercent(window: UsageLimitsSnapshot["codex"]["primaryWindow"] | null) {
  if (!window || !Number.isFinite(window.usedPercent)) {
    return null;
  }
  return Math.min(100, Math.max(0, 100 - window.usedPercent));
}

function getCursorRemainingPercent(limits: UsageLimitsSnapshot["cursor"] | undefined) {
  if (!limits) {
    return null;
  }
  const { rawPlanUsed, rawPlanLimit } = limits;
  if (rawPlanUsed !== null && Number.isFinite(rawPlanUsed) &&
      rawPlanLimit !== null && Number.isFinite(rawPlanLimit) && rawPlanLimit > 0) {
    return Math.min(100, Math.max(0, (1 - rawPlanUsed / rawPlanLimit) * 100));
  }
  return getRemainingPercent(limits.primaryWindow);
}

function formatResetAt(resetAt: string | number | null) {
  if (!resetAt) {
    return "-";
  }

  const date =
    typeof resetAt === "number"
      ? new Date(resetAt * 1000)
      : new Date(resetAt);
  if (!Number.isFinite(date.getTime())) {
    return "-";
  }

  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function KpiCard(props: { label: string; value: string; sub?: string; sub2?: string }) {
  return (
    <article className="kpi-card">
      <span className="kpi-label">{props.label}</span>
      <strong className="kpi-value">{props.value}</strong>
      {(props.sub || props.sub2) && (
        <div className="kpi-sub-row">
          {props.sub && <span className="kpi-sub">{props.sub}</span>}
          {props.sub2 && <span className="kpi-sub kpi-sub-muted">= {props.sub2}</span>}
        </div>
      )}
    </article>
  );
}

function CalendarHeatmap({ rows }: { rows: DailyUsageRow[] }) {
  const [hovered, setHovered] = useState<{ date: string; tokens: number; costUsd: number; left: number; top: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const tokensByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.date, row.combinedTotalTokens);
    }
    return map;
  }, [rows]);

  const costByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.date, row.combinedEstimatedCostUsd);
    }
    return map;
  }, [rows]);

  const { weeks, months, maxVal } = useMemo(() => {
    if (rows.length === 0) {
      return { weeks: [] as string[][], months: [] as Array<{ label: string; col: number }>, maxVal: 0 };
    }

    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    const startDate = new Date(`${first.date}T00:00:00`);
    const endDate = new Date(`${last.date}T00:00:00`);

    const dayMs = 86_400_000;
    const weekStart = new Date(startDate.getTime() - startDate.getDay() * dayMs);
    const allWeeks: string[][] = [];
    const allMonths: Array<{ label: string; col: number }> = [];
    let prevMonth = -1;
    let current = new Date(weekStart);

    while (current <= endDate || allWeeks.length === 0) {
      const week: string[] = [];
      for (let day = 0; day < 7; day += 1) {
        const iso = toIsoDate(current);
        if (current >= startDate && current <= endDate) {
          week.push(iso);
        } else {
          week.push("");
        }

        const month = current.getMonth();
        if (month !== prevMonth && current >= startDate && current <= endDate) {
          allMonths.push({
            label: current.toLocaleString("en-US", { month: "short" }),
            col: allWeeks.length,
          });
          prevMonth = month;
        }

        current = new Date(current.getTime() + dayMs);
      }
      allWeeks.push(week);
    }

    const max = Math.max(...Array.from(tokensByDate.values()), 1);
    return { weeks: allWeeks, months: allMonths, maxVal: max };
  }, [rows, tokensByDate]);

  if (weeks.length === 0) {
    return null;
  }

  const dayLabels = ["", "Mon", "", "Wed", "", "Fri", ""];
  const legendLevels = Array.from({ length: HEATMAP_LEVELS + 1 }, (_, index) => index);

  return (
    <div className="heatmap-wrap" ref={wrapRef}>
      <div className="heatmap-body">
        <div className="heatmap-day-labels">
          {dayLabels.map((label, index) => (
            <span key={index}>{label}</span>
          ))}
        </div>
        <div className="heatmap-track">
          <div className="heatmap-months">
            {months.map((month, index) => (
              <span
                key={index}
                className="heatmap-month"
                style={{ "--month-col": month.col } as CSSProperties}
              >
                {month.label}
              </span>
            ))}
          </div>
          <div className="heatmap-grid">
            {weeks.map((week, weekIndex) =>
              week.map((date, dayIndex) => {
                const value = date ? (tokensByDate.get(date) ?? 0) : -1;
                const level =
                  value < 0
                    ? -1
                    : value === 0
                      ? 0
                      : Math.min(HEATMAP_LEVELS, Math.ceil((value / maxVal) * HEATMAP_LEVELS));
                return (
                  <div
                    key={`${weekIndex}-${dayIndex}`}
                    className="heatmap-cell"
                    data-level={level}
                    title={date ? `${date}: ${fmtNum(Math.max(0, value))} tokens` : ""}
                    onMouseEnter={(event) => {
                      if (!date || value < 0 || !wrapRef.current) {
                        setHovered(null);
                        return;
                      }

                      const cellRect = event.currentTarget.getBoundingClientRect();
                      const wrapRect = wrapRef.current.getBoundingClientRect();
                      setHovered({
                        date,
                        tokens: Math.max(0, value),
                        costUsd: costByDate.get(date) ?? 0,
                        left: cellRect.left - wrapRect.left + cellRect.width / 2,
                        top: cellRect.top - wrapRect.top - 8,
                      });
                    }}
                    onMouseLeave={() => setHovered(null)}
                  />
                );
              }),
            )}
          </div>
        </div>
      </div>
      {hovered && (
        <div className="heatmap-tooltip heatmap-tooltip-floating" style={{ left: hovered.left, top: hovered.top }}>
          <strong>{hovered.date}</strong>
          <span>{fmtChineseCompact(hovered.tokens)}</span>
          <span className="heatmap-tooltip-muted">{fmtUsd(hovered.costUsd)}</span>
        </div>
      )}
      <div className="heatmap-legend">
        <span>Less</span>
        {legendLevels.map((level) => (
          <div key={level} className="heatmap-cell heatmap-legend-cell" data-level={level} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

function ModelChart({ models }: { models: ModelUsageEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  const visibleModels = expanded ? models : models.slice(0, 5);
  const total = visibleModels.reduce((sum, model) => sum + model.totalTokens, 0);

  if (total === 0) {
    return <p className="empty-text">No model data</p>;
  }

  const palette = ["#D94632", "#E8705E", "#F08D7E", "#F5A89A", "#F7C7BE"];

  return (
    <div className="model-chart">
      <div className="model-bar-composite">
        {visibleModels.map((model, index) => {
          const pct = (model.totalTokens / total) * 100;
          if (pct < 0.5) {
            return null;
          }
          return (
            <div
              key={model.model}
              className="model-bar-seg"
              style={{ width: `${pct}%`, background: palette[index % palette.length] }}
              title={`${model.model}: ${fmtPercent(model.totalTokens / total)}`}
            />
          );
        })}
      </div>
      <div className="model-list">
        {visibleModels.map((model, index) => (
          <div key={model.model} className="model-row">
            <span className="model-dot" style={{ background: palette[index % palette.length] }} />
            <span className="model-name">{model.model}</span>
            <span className="model-pct">{fmtPercent(model.totalTokens / total)}</span>
            <span className="model-tokens">{fmtCompact(model.totalTokens)}</span>
            <span className="model-cost">{fmtUsdCompact(model.costUsd)}</span>
          </div>
        ))}
      </div>
      {models.length > 5 && (
        <div className="model-actions">
          <button className="btn-secondary" onClick={() => setExpanded((value) => !value)} type="button">
            {expanded ? "Collapse" : `Show all (${models.length})`}
          </button>
        </div>
      )}
    </div>
  );
}

function DataTable({ rows }: { rows: DailyUsageRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = [...rows].filter((row) => row.combinedTotalTokens > 0).reverse();
  const displayed = expanded ? visible : visible.slice(0, 5);

  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Source</th>
              <th>Codex Tokens</th>
              <th>Cursor Tokens</th>
              <th>Combined</th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((row) => (
              <tr key={row.date}>
                <td>{row.date}</td>
                <td>{row.codexTotalTokens > 0 && row.cursorTotalTokens > 0 ? "Both" : row.codexTotalTokens > 0 ? "Codex" : "Cursor"}</td>
                <td title={fmtNum(row.codexTotalTokens)}>{fmtChineseCompact(row.codexTotalTokens)}</td>
                <td title={fmtNum(row.cursorTotalTokens)}>{fmtChineseCompact(row.cursorTotalTokens)}</td>
                <td className="td-strong" title={fmtNum(row.combinedTotalTokens)}>
                  {fmtChineseCompact(row.combinedTotalTokens)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {visible.length > 5 && (
        <div className="table-actions">
          <button className="btn-secondary" onClick={() => setExpanded((value) => !value)} type="button">
            {expanded ? "Collapse" : `Show all (${visible.length})`}
          </button>
        </div>
      )}
    </>
  );
}

const fmtCompact = (value: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);

const fmtNum = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);

const fmtPercent = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(value);

const fmtUsd = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

const fmtUsdCompact = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);

const fmtChineseLarge = (value: number) => `${trimTrailingZeros((value / 100_000_000).toFixed(2))} \u4ebf`;

const fmtChineseCompact = (value: number) => {
  if (value >= 100_000_000) {
    return `${trimTrailingZeros((value / 100_000_000).toFixed(2))} \u4ebf`;
  }
  if (value >= 10_000_000) {
    return `${trimTrailingZeros((value / 10_000_000).toFixed(2))} \u5343\u4e07`;
  }
  if (value >= 10_000) {
    return `${trimTrailingZeros((value / 10_000).toFixed(2))} \u4e07`;
  }
  return fmtNum(value);
};

const trimTrailingZeros = (value: string) => value.replace(/\.?0+$/, "");

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function createReportOptions(defaults: AppDefaults, from: string, to: string): AppReportOptions {
  return {
    from,
    to,
    timezone: defaults.timezone,
    codexRoot: defaults.codexRoot,
    outDir: defaults.outDir,
    sources: ["codex", "cursor"],
    cursorAppDir: defaults.cursorAppDir,
    cursorCliConfigPath: defaults.cursorCliConfigPath,
  };
}
