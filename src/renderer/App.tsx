import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { AppDefaults, AppReportOptions, GenerateReportResult, ModelUsageEntry } from "../contracts.js";
import type { DailyUsageRow } from "../types.js";
import { getTokenMonitorBridge } from "./bridge.js";
import { CZLogo } from "./CZLogo.js";

const bridge = getTokenMonitorBridge();

type TimeScale = "week" | "month" | "year" | "custom";

const SCALE_ORDER: TimeScale[] = ["week", "month", "year", "custom"];
const SCALE_LABEL: Record<TimeScale, string> = {
  week: "Week",
  month: "Month",
  year: "Year",
  custom: "Custom",
};

const HEATMAP_LEVELS = 6;

export function App() {
  const [defaults, setDefaults] = useState<AppDefaults | null>(null);
  const [report, setReport] = useState<GenerateReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoloaded, setAutoloaded] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [timeScale, setTimeScale] = useState<TimeScale>("custom");

  useEffect(() => {
    void bridge.getDefaults().then((value) => {
      setDefaults(value);
      setDateFrom(value.from);
      setDateTo(value.to);
      setTimeScale("custom");
    });
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
    };
    const syncOnVisible = () => {
      if (document.visibilityState === "visible") {
        void syncDefaultsAndMaybeRefresh(false);
      }
    };
    const timer = window.setInterval(() => {
      void syncDefaultsAndMaybeRefresh(false);
    }, 60_000);

    window.addEventListener("focus", syncOnFocus);
    document.addEventListener("visibilitychange", syncOnVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", syncOnFocus);
      document.removeEventListener("visibilitychange", syncOnVisible);
    };
  }, [defaults, dateFrom, dateTo, timeScale]);

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

    if (!defaults || !dateFrom || !dateTo) {
      if (defaultsChanged) {
        setDefaults(nextDefaults);
      }
      setDateFrom(nextDefaults.from);
      setDateTo(nextDefaults.to);
      setTimeScale("custom");
      if (forceRefresh) {
        await runReport(createReportOptions(nextDefaults, nextDefaults.from, nextDefaults.to));
      }
      return;
    }

    let nextFrom = dateFrom;
    let nextTo = dateTo;
    let shouldRefresh = forceRefresh;

    if (timeScale === "custom") {
      if (dateTo === defaults.to) {
        nextTo = nextDefaults.to;
        if (dateFrom === defaults.from) {
          nextFrom = nextDefaults.from;
        }
        shouldRefresh ||= nextFrom !== dateFrom || nextTo !== dateTo;
      }
    } else {
      const nextRange = buildScaledRange(nextDefaults.to, timeScale);
      nextFrom = nextRange.from;
      nextTo = nextRange.to;
      shouldRefresh ||= nextFrom !== dateFrom || nextTo !== dateTo;
    }

    if (defaultsChanged) {
      setDefaults(nextDefaults);
    }

    if (!shouldRefresh) {
      return;
    }

    setDateFrom(nextFrom);
    setDateTo(nextTo);
    await runReport(createReportOptions(nextDefaults, nextFrom, nextTo));
  }

  function handleDateChange(from: string, to: string) {
    setDateFrom(from);
    setDateTo(to);
    setTimeScale("custom");
    if (!defaults) {
      return;
    }
    void runReport(createReportOptions(defaults, from, to));
  }

  function handleScaleChange(nextScale: TimeScale) {
    if (!defaults) {
      return;
    }
    if (nextScale === "custom") {
      setTimeScale("custom");
      return;
    }

    const anchor = dateTo || defaults.to;
    const range = buildScaledRange(anchor, nextScale);
    setTimeScale(nextScale);
    setDateFrom(range.from);
    setDateTo(range.to);
    void runReport(createReportOptions(defaults, range.from, range.to));
  }

  const today = dateTo || toIsoDate(new Date());
  const todayData = report?.rows.find((row) => row.date === today);
  const monthKey = today.slice(0, 7);
  const monthRows = (report?.rows ?? []).filter((row) => row.date.startsWith(monthKey));
  const monthTokens = monthRows.reduce((sum, row) => sum + row.combinedTotalTokens, 0);
  const monthCost = monthRows.reduce((sum, row) => sum + row.combinedEstimatedCostUsd, 0);
  const todayTokens = todayData?.combinedTotalTokens ?? 0;
  const todayCost = todayData?.combinedEstimatedCostUsd ?? 0;

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

        {!report ? (
          <section className="empty-state">
            <p>Loading data...</p>
          </section>
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
                <div className="activity-controls">
                  <div
                    className="scale-switch"
                    role="tablist"
                    aria-label="Time scale"
                    style={
                      {
                        "--scale-count": SCALE_ORDER.length,
                        "--scale-index": Math.max(0, SCALE_ORDER.indexOf(timeScale)),
                      } as CSSProperties
                    }
                  >
                    <span className="scale-switch-indicator" aria-hidden="true" />
                    {SCALE_ORDER.map((scale) => {
                      const active = timeScale === scale;
                      return (
                        <button
                          key={scale}
                          role="tab"
                          aria-selected={active}
                          className={`scale-chip${active ? " scale-chip-active" : ""}`}
                          onClick={() => handleScaleChange(scale)}
                          type="button"
                        >
                          {SCALE_LABEL[scale]}
                        </button>
                      );
                    })}
                  </div>
                  <div className="date-range">
                    <input type="date" value={dateFrom} onChange={(event) => handleDateChange(event.target.value, dateTo)} />
                    <input type="date" value={dateTo} onChange={(event) => handleDateChange(dateFrom, event.target.value)} />
                  </div>
                </div>
              </div>
              <CalendarHeatmap rows={report.rows} />
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

function buildScaledRange(anchorIso: string, scale: Exclude<TimeScale, "custom">) {
  const anchor = new Date(`${anchorIso}T00:00:00`);
  const to = toIsoDate(anchor);
  const fromDate = new Date(anchor);

  if (scale === "week") {
    const day = fromDate.getDay();
    const diff = day === 0 ? 6 : day - 1;
    fromDate.setDate(fromDate.getDate() - diff);
  } else if (scale === "month") {
    fromDate.setDate(1);
  } else {
    fromDate.setFullYear(fromDate.getFullYear() - 1);
  }

  return { from: toIsoDate(fromDate), to };
}
