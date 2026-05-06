"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { Position } from "@/types/position";
import { MarketIndicators } from "@/types/market";
import { MarketHeader } from "@/components/MarketHeader";
import { useMarketTicks } from "@/contexts/MarketTicksContext";
import type { AutoExitStreamEvent } from "@/types/auto-exit-stream";
import { useState, useEffect, useRef, useMemo } from "react";

/**
 * Positions Page — Phase 5
 *
 * Displays active 5paisa derivatives positions with:
 * - Live P&L — pushed over WebSocket (gateway) when `NEXT_PUBLIC_XSTREAM_WS_URL` is set; else REST poll
 * - Auto-Exit toggle (enable/disable engine for all positions)
 * - Risk summary dashboard
 * - Event log: WebSocket `auto-exit-events` from gateway, or EventSource to `/api/v1/auto-exit/events` as fallback
 */

// ─── API helpers ─────────────────────────────

type PositionsBlock = {
  positions: Position[];
  margin: { availableMargin: number; usedMargin: number; netMargin: number; marginUtilizedPct: number } | null;
  fundsBreakdown: {
    buyPremium: number;
    sellPremium: number;
    spreadMargin: number;
    nakedSellMargin: number;
    netPremium: number;
  } | null;
};

type TradingPageSnapshot = {
  positions: PositionsBlock;
  autoExit: {
    engine: boolean;
    watched: any[];
    riskSummary: any;
    portfolio: { peakPnlPct: number; currentTrailingSLPct: number } | null;
  };
  indicators: MarketIndicators;
};

async function toggleAutoExit(action: "enable" | "disable"): Promise<any> {
  const config: Record<string, number> = {
    stopLossPercent: 1.0,
    trailOffsetPercent: 1.0,
    profitFloorPercent: 2.0,
  };
  const res = await fetch("/api/v1/auto-exit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, config }),
  });
  if (!res.ok) throw new Error("Failed to toggle auto-exit");
  return res.json();
}

async function exitAllPositions(): Promise<any> {
  const res = await fetch("/api/v1/auto-exit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "exit-all" }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof data?.error === "string"
        ? data.error
        : typeof data?.message === "string"
          ? data.message
          : "Failed to exit all positions";
    throw new Error(msg);
  }
  return data;
}

async function fetchTradingSnapshot(
  queryClient: QueryClient,
): Promise<TradingPageSnapshot> {
  const res = await fetch("/api/v1/trading/snapshot");
  if (!res.ok) throw new Error("Failed to fetch trading snapshot");
  const data = (await res.json()) as TradingPageSnapshot;
  queryClient.setQueryData(["indicators"], data.indicators);
  return data;
}

// ─── Component ───────────────────────────────

export default function PositionsPage() {
  const queryClient = useQueryClient();
  const [sseEventLog, setSseEventLog] = useState<AutoExitStreamEvent[]>([]);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  const rt = useMarketTicks();
  const hasWs = Boolean(process.env.NEXT_PUBLIC_XSTREAM_WS_URL?.trim());
  const tradingOverWs = Boolean(
    hasWs && rt?.connection === "open" && rt.hasTradingSnapshotOverWs,
  );

  const eventLog: AutoExitStreamEvent[] = tradingOverWs
    ? (rt?.autoExitEventLog ?? [])
    : sseEventLog;

  // Initial load: REST. After gateway streams snapshot over WS, stop interval polling.
  const { data, isLoading, error } = useQuery({
    queryKey: ["tradingSnapshot"],
    queryFn: () => fetchTradingSnapshot(queryClient),
    refetchInterval: tradingOverWs ? false : 2500,
    staleTime: tradingOverWs ? 60_000 : 2000,
  });
  const mergedIndicators = rt?.applyLiveToIndicators(data?.indicators) ?? data?.indicators;
  const autoExitData = data?.autoExit;

  const engineRunning = autoExitData?.engine ?? false;
  const watchedCount = autoExitData?.watched?.length ?? 0;

  // Toggle mutation
  const toggleMutation = useMutation({
    mutationFn: (action: "enable" | "disable") => toggleAutoExit(action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tradingSnapshot"] });
      queryClient.invalidateQueries({ queryKey: ["indicators"] });
    },
  });

  // Exit all mutation
  const exitAllMutation = useMutation({
    mutationFn: exitAllPositions,
    onSuccess: () => {
      setShowExitConfirm(false);
      queryClient.invalidateQueries({ queryKey: ["tradingSnapshot"] });
      queryClient.invalidateQueries({ queryKey: ["indicators"] });
      queryClient.invalidateQueries({ queryKey: ["journal"] });
      queryClient.invalidateQueries({ queryKey: ["journal-pnl"] });
    },
  });

  // SSE for auto-exit log only when not using the gateway WebSocket stream
  useEffect(() => {
    if (tradingOverWs) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      return;
    }
    if (!engineRunning) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      return;
    }
    const es = new EventSource("/api/v1/auto-exit/events");
    eventSourceRef.current = es;
    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as AutoExitStreamEvent;
        setSseEventLog((prev) => [event, ...prev].slice(0, 50));
      } catch {
        // ignore
      }
    };
    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [engineRunning, tradingOverWs]);

  // One-time event bootstrap when on SSE (no WS)
  useEffect(() => {
    if (tradingOverWs || !engineRunning) return;
    fetch("/api/v1/auto-exit/events?poll=true")
      .then((r) => r.json())
      .then((d) => {
        if (d.events?.length) {
          setSseEventLog((prev) => {
            const existing = new Set(prev.map((e) => e.timestamp));
            const newEvents = (d.events as AutoExitStreamEvent[]).filter(
              (e) => !existing.has(e.timestamp),
            );
            return [...newEvents.reverse(), ...prev].slice(0, 50);
          });
        }
      })
      .catch(() => {});
  }, [engineRunning, tradingOverWs]);

  const posBlock = data?.positions;
  const positions = (posBlock?.positions ?? []).filter((p: Position) => p.status === "OPEN");
  const margin = posBlock?.margin ?? null;
  const funds = posBlock?.fundsBreakdown ?? null;
  const brokerMargin = margin && margin.usedMargin > 0 ? margin.usedMargin : 0;
  const positionSum = positions.reduce((sum, p) => sum + p.capitalDeployed, 0);
  const totalCapital = brokerMargin > 0 ? brokerMargin : positionSum;

  const expiryInfo = useMemo(() => {
    const expiryDates: Date[] = [];
    for (const pos of positions) {
      const match = pos.symbol.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/i);
      if (match) {
        const d = new Date(`${match[2]} ${match[1]}, ${match[3]}`);
        if (!isNaN(d.getTime())) expiryDates.push(d);
      }
    }
    if (expiryDates.length === 0) return null;
    const nearest = new Date(Math.min(...expiryDates.map((d) => d.getTime())));
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let daysRemaining = 0;
    const cursor = new Date(today);
    while (cursor < nearest) {
      cursor.setDate(cursor.getDate() + 1);
      const day = cursor.getDay();
      if (day !== 0 && day !== 6) daysRemaining++;
    }
    return { date: nearest, daysRemaining };
  }, [positions]);

  const positionRows = useMemo(
    () =>
      positions.map((pos) => {
        const watchState = autoExitData?.watched?.find((w: any) => w.positionId === pos.positionId);
        const isBuy = pos.quantity > 0;
        const displayStrike =
          pos.strike > 0
            ? pos.strike
            : (() => {
                const m = pos.symbol.match(/(CE|PE)\s+([\d.]+)/i);
                return m ? parseFloat(m[2]) : 0;
              })();
        return { pos, watchState, isBuy, displayStrike };
      }),
    [positions, autoExitData?.watched],
  );

  if (isLoading) {
    return (
      <div className="mx-auto flex min-h-[40vh] max-w-7xl flex-col items-center justify-center gap-4 px-2">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-vz-primary border-t-transparent" />
        <p className="text-sm text-vz-muted">Loading positions…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-rose-500/30 bg-rose-950/20 px-4 py-8 text-center">
        <p className="font-medium text-rose-300">Couldn&apos;t load positions</p>
        <p className="mt-2 text-sm text-vz-muted">Check your connection and try refreshing the page.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 pb-10 sm:space-y-6">
      {/* Actions & status */}
      <section className="rounded-xl border border-white/[0.08] bg-vz-card/60 p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:w-auto">
              {positions.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowExitConfirm(true)}
                  disabled={exitAllMutation.isPending}
                  className="min-h-[44px] w-full touch-manipulation rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                >
                  {exitAllMutation.isPending ? "Exiting…" : "Exit all"}
                </button>
              )}
              <button
                type="button"
                onClick={() => toggleMutation.mutate(engineRunning ? "disable" : "enable")}
                disabled={toggleMutation.isPending}
                className={`min-h-[44px] w-full touch-manipulation rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition sm:w-auto ${
                  engineRunning
                    ? "bg-rose-600 hover:bg-rose-500"
                    : "bg-amber-600 hover:bg-amber-500"
                } ${toggleMutation.isPending ? "cursor-not-allowed opacity-50" : ""}`}
              >
                {toggleMutation.isPending
                  ? "…"
                  : engineRunning
                    ? `Auto-exit on (${watchedCount})`
                    : "Enable auto-exit"}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-vz-muted">
              <span className="rounded-md bg-white/[0.06] px-2.5 py-1 font-medium text-vz-foreground">
                {positions.length} open
              </span>
              <span className="hidden sm:inline">·</span>
              <span>Live refresh</span>
              {expiryInfo && (
                <span
                  className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ${
                    expiryInfo.daysRemaining === 0
                      ? "bg-red-500/15 text-red-300"
                      : expiryInfo.daysRemaining <= 1
                        ? "bg-amber-500/15 text-amber-200"
                        : "bg-white/[0.06] text-vz-muted"
                  }`}
                >
                  {expiryInfo.daysRemaining === 0
                    ? "Expiry today"
                    : `${expiryInfo.daysRemaining}d to expiry`}
                </span>
              )}
            </div>
          </div>
          <p className="text-xs text-vz-muted sm:hidden">
            Tip: rotate to landscape for the full table.
          </p>
        </div>
      </section>

      <MarketHeader indicators={mergedIndicators ?? null} />

      {/* Engine Status Banner */}
      {/* Trailing SL Status */}
      {engineRunning && autoExitData?.portfolio && (
        <section className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-2 text-xs font-medium text-emerald-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Engine running · {watchedCount} watched · server-side
          </div>
          <div
            className={`grid gap-3 ${
              expiryInfo ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2 lg:grid-cols-3"
            }`}
          >
            <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3 sm:p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-sky-400/90">Trailing SL</div>
              <div
                className={`mt-1 text-2xl font-bold tabular-nums sm:text-3xl ${
                  autoExitData.portfolio.currentTrailingSLPct >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {autoExitData.portfolio.currentTrailingSLPct >= 0 ? "+" : ""}
                {autoExitData.portfolio.currentTrailingSLPct.toFixed(1)}%
              </div>
              <p className="mt-1 text-[11px] leading-snug text-vz-muted">
                Exit near ₹
                {(totalCapital * autoExitData.portfolio.currentTrailingSLPct / 100).toLocaleString("en-IN", {
                  maximumFractionDigits: 0,
                })}{" "}
                P&amp;L
              </p>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3 sm:p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-sky-400/90">Peak P&amp;L</div>
              <div className="mt-1 text-2xl font-bold tabular-nums text-sky-300 sm:text-3xl">
                +{autoExitData.portfolio.peakPnlPct.toFixed(2)}%
              </div>
            </div>
            <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3 sm:p-4">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-sky-400/90">Status</div>
              <p className="mt-2 text-sm font-medium leading-snug text-vz-foreground">
                {autoExitData.portfolio.currentTrailingSLPct < 0 && "Stop-loss active"}
                {autoExitData.portfolio.currentTrailingSLPct === 0 && "At breakeven"}
                {autoExitData.portfolio.currentTrailingSLPct > 0 &&
                  autoExitData.portfolio.currentTrailingSLPct < 2 &&
                  "Profit locked"}
                {autoExitData.portfolio.currentTrailingSLPct >= 2 && "Profit floor secured"}
              </p>
              <p className="mt-1 text-[10px] text-vz-muted">SL only ratchets up</p>
            </div>
            {expiryInfo ? (
              <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3 sm:p-4">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-sky-400/90">Expiry</div>
                <div
                  className={`mt-1 text-2xl font-bold tabular-nums sm:text-3xl ${
                    expiryInfo.daysRemaining === 0
                      ? "text-rose-400"
                      : expiryInfo.daysRemaining <= 1
                        ? "text-amber-400"
                        : expiryInfo.daysRemaining <= 3
                          ? "text-yellow-400"
                          : "text-vz-foreground"
                  }`}
                >
                  {expiryInfo.daysRemaining === 0 ? "Today" : `${expiryInfo.daysRemaining}d`}
                </div>
                <p className="mt-1 text-[10px] text-vz-muted">
                  {expiryInfo.date.toLocaleDateString("en-IN", {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}{" "}
                  · trading days
                </p>
              </div>
            ) : null}
          </div>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-white/[0.06] pt-3 text-[11px] text-vz-muted">
            <span>Initial: −1%</span>
            <span>Trail: 1%</span>
            <span>Floor: 2%</span>
          </div>
        </section>
      )}

      {/* Risk summary */}
      <section aria-label="Risk summary" className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-vz-muted">Snapshot</h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-xl border border-white/[0.08] bg-vz-card/50 p-3 sm:p-4">
            <div className="text-xs text-vz-muted">Margin required</div>
            <div className="mt-1 text-lg font-bold tabular-nums text-vz-foreground sm:text-xl">
              ₹{brokerMargin.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </div>
            {funds && funds.spreadMargin > 0 && (
              <div className="mt-1 text-[11px] text-vz-muted">
                Spread ₹{funds.spreadMargin.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
              </div>
            )}
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-vz-card/50 p-3 sm:p-4">
            <div className="text-xs text-vz-muted">Premiums (net)</div>
            <div className="mt-1 text-lg font-bold tabular-nums text-vz-foreground sm:text-xl">
              ₹{(funds?.netPremium ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </div>
            <div className="mt-1 text-[11px] leading-snug text-vz-muted">
              Sell ₹{(funds?.sellPremium ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })} · Buy ₹
              {(funds?.buyPremium ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-vz-card/50 p-3 sm:p-4">
            <div className="text-xs text-vz-muted">Total P&amp;L</div>
            {(() => {
              const totalPnl = positions.reduce((s, p) => s + p.pl, 0);
              const pnlPct = totalCapital > 0 ? (totalPnl / totalCapital) * 100 : 0;
              return (
                <>
                  <div
                    className={`mt-1 text-lg font-bold tabular-nums sm:text-xl ${
                      totalPnl >= 0 ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    ₹{totalPnl.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                  </div>
                  <div
                    className={`text-[11px] ${pnlPct >= 0 ? "text-emerald-500/90" : "text-rose-500/90"}`}
                  >
                    {pnlPct >= 0 ? "+" : ""}
                    {pnlPct.toFixed(2)}% vs capital
                  </div>
                </>
              );
            })()}
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-vz-card/50 p-3 sm:p-4">
            <div className="text-xs text-vz-muted">Capital (SL base)</div>
            <div className="mt-1 text-lg font-bold tabular-nums text-violet-300 sm:text-xl">
              ₹{totalCapital.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </div>
            <div className="mt-1 text-[11px] text-vz-muted">
              {brokerMargin > 0 ? "Broker margin" : "From positions"}
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.08] bg-vz-card/50 p-3 sm:p-4">
            <div className="text-xs text-vz-muted">Max loss @1%</div>
            <div className="mt-1 text-lg font-bold tabular-nums text-amber-300 sm:text-xl">
              ₹{(totalCapital * 0.01).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </div>
          </div>
          <div className="col-span-2 rounded-xl border border-white/[0.08] bg-vz-card/50 p-3 sm:p-4 md:col-span-1 lg:col-span-1">
            <div className="text-xs text-vz-muted">Profit floor @2%</div>
            <div className="mt-1 text-lg font-bold tabular-nums text-sky-300 sm:text-xl">
              ₹{(totalCapital * 0.02).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </div>
          </div>
        </div>
      </section>

      {/* Positions */}
      <section aria-labelledby="positions-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="positions-heading" className="text-sm font-semibold text-vz-foreground">
            Open positions
          </h2>
          <span className="hidden text-xs text-vz-muted md:inline">Full table from tablet size up.</span>
        </div>

        {positions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/[0.12] bg-vz-card/30 px-4 py-12 text-center">
            <p className="font-medium text-vz-foreground">No open positions</p>
            <p className="mt-2 text-sm text-vz-muted">When you have trades, they will show here with live P&amp;L.</p>
          </div>
        ) : (
          <>
            {/* Mobile: card stack */}
            <ul className="space-y-3 md:hidden">
              {positionRows.map(({ pos, watchState, isBuy, displayStrike }) => (
                <li
                  key={pos.positionId}
                  className="rounded-xl border border-white/[0.08] bg-vz-card/40 p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 break-words text-sm font-medium leading-snug text-vz-foreground">
                      {pos.symbol}
                    </p>
                    <p
                      className={`shrink-0 text-right text-lg font-bold tabular-nums ${
                        pos.pl >= 0 ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      ₹{pos.pl.toFixed(2)}
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span
                      className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                        pos.optionType === "CALL"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "bg-rose-500/15 text-rose-300"
                      }`}
                    >
                      {pos.optionType}
                    </span>
                    <span
                      className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                        isBuy ? "bg-sky-500/15 text-sky-300" : "bg-orange-500/15 text-orange-200"
                      }`}
                    >
                      {isBuy ? "Buy" : "Sell"}
                    </span>
                    <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[11px] text-vz-muted">
                      Qty {Math.abs(pos.quantity)}
                    </span>
                    {displayStrike > 0 && (
                      <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-[11px] text-vz-muted">
                        Strike {displayStrike}
                      </span>
                    )}
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <div>
                      <dt className="text-vz-muted">Avg</dt>
                      <dd className="font-mono text-vz-foreground">₹{pos.avgPrice.toFixed(2)}</dd>
                    </div>
                    <div>
                      <dt className="text-vz-muted">LTP</dt>
                      <dd className="font-mono text-vz-foreground">₹{pos.ltp.toFixed(2)}</dd>
                    </div>
                    <div>
                      <dt className="text-vz-muted">Premium</dt>
                      <dd className="font-mono text-vz-foreground">₹{pos.capitalDeployed.toLocaleString()}</dd>
                    </div>
                    {engineRunning ? (
                      <div className="col-span-2 sm:col-span-1">
                        <dt className="text-vz-muted">Auto-exit</dt>
                        <dd className="text-emerald-400">
                          {watchState ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                              SL{" "}
                              {(autoExitData?.portfolio?.currentTrailingSLPct ?? watchState.currentSLPercent).toFixed(
                                1,
                              )}
                              %
                            </span>
                          ) : (
                            <span className="text-vz-muted">—</span>
                          )}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </li>
              ))}
            </ul>

            {/* Desktop: table */}
            <div className="hidden overflow-x-auto rounded-xl border border-white/[0.08] md:block">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="border-b border-white/[0.08] bg-black/20 text-left text-xs font-semibold uppercase tracking-wider text-vz-muted">
                  <tr>
                    <th className="px-4 py-3">Symbol</th>
                    <th className="px-4 py-3 text-right">Strike</th>
                    <th className="px-4 py-3 text-center">Type</th>
                    <th className="px-4 py-3 text-center">Side</th>
                    <th className="px-4 py-3 text-right">Qty</th>
                    <th className="px-4 py-3 text-right">Avg</th>
                    <th className="px-4 py-3 text-right">LTP</th>
                    <th className="px-4 py-3 text-right">P&amp;L</th>
                    <th className="px-4 py-3 text-right">Premium</th>
                    {engineRunning && <th className="px-4 py-3 text-center">Watch</th>}
                  </tr>
                </thead>
                <tbody>
                  {positionRows.map(({ pos, watchState, isBuy, displayStrike }) => (
                    <tr
                      key={pos.positionId}
                      className="border-b border-white/[0.06] transition hover:bg-white/[0.03]"
                    >
                      <td className="max-w-[14rem] truncate px-4 py-3 font-medium text-vz-foreground">{pos.symbol}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                        {displayStrike > 0 ? displayStrike : "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                            pos.optionType === "CALL"
                              ? "bg-emerald-500/15 text-emerald-300"
                              : "bg-rose-500/15 text-rose-300"
                          }`}
                        >
                          {pos.optionType}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                            isBuy ? "bg-sky-500/15 text-sky-300" : "bg-orange-500/15 text-orange-200"
                          }`}
                        >
                          {isBuy ? "BUY" : "SELL"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{Math.abs(pos.quantity)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">₹{pos.avgPrice.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">₹{pos.ltp.toFixed(2)}</td>
                      <td
                        className={`px-4 py-3 text-right font-mono text-xs font-semibold tabular-nums ${
                          pos.pl >= 0 ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        ₹{pos.pl.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                        ₹{pos.capitalDeployed.toLocaleString()}
                      </td>
                      {engineRunning && (
                        <td className="px-4 py-3 text-center">
                          {watchState ? (
                            <span className="inline-flex items-center justify-center gap-1 text-xs text-emerald-400">
                              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                              SL:{" "}
                              {(autoExitData?.portfolio?.currentTrailingSLPct ?? watchState.currentSLPercent).toFixed(1)}%
                            </span>
                          ) : (
                            <span className="text-xs text-vz-muted">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Event Log */}
      {(engineRunning || eventLog.length > 0) && (
        <section className="mt-8 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-vz-foreground">
              Auto-exit log
              {tradingOverWs && (
                <span className="ml-2 text-xs font-normal text-emerald-400/90">WebSocket</span>
              )}
            </h2>
            {!tradingOverWs && eventLog.length > 0 && (
              <button
                type="button"
                onClick={() => setSseEventLog([])}
                className="min-h-[40px] min-w-[44px] touch-manipulation text-xs text-vz-muted underline-offset-4 hover:text-vz-foreground hover:underline"
              >
                Clear
              </button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto rounded-xl border border-white/[0.08] bg-black/20 sm:max-h-64">
            {eventLog.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-vz-muted">
                No events yet. The engine is monitoring positions…
              </div>
            ) : (
              eventLog.map((evt, i) => (
                <div
                  key={`${evt.timestamp}-${i}`}
                  className="flex items-start gap-3 border-b border-white/[0.06] px-3 py-3 last:border-0 sm:px-4"
                >
                  <span className="mt-0.5 shrink-0 text-base" aria-hidden>
                    {evt.type === "STOP_LOSS" && "🔴"}
                    {evt.type === "TAKE_PROFIT" && "🟢"}
                    {evt.type === "BREAKEVEN" && "⚪"}
                    {evt.type === "TRAIL_UPDATE" && "📈"}
                    {evt.type === "WATCH_STARTED" && "👁️"}
                    {evt.type === "WATCH_STOPPED" && "🛑"}
                    {evt.type === "ENGINE_STARTED" && "🚀"}
                    {evt.type === "ENGINE_STOPPED" && "⏹️"}
                    {evt.type === "EXIT_TRIGGER" && "⚡"}
                    {evt.type === "TICK" && "💓"}
                    {evt.type === "ERROR" && "❌"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm leading-snug text-vz-foreground">{evt.message}</div>
                    <div className="mt-0.5 text-xs text-vz-muted">
                      {new Date(evt.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium ${
                      evt.type === "STOP_LOSS"
                        ? "bg-rose-500/15 text-rose-300"
                        : evt.type === "TAKE_PROFIT"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : evt.type === "TRAIL_UPDATE"
                            ? "bg-sky-500/15 text-sky-300"
                            : "bg-white/[0.06] text-vz-muted"
                    }`}
                  >
                    {evt.type}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      )}
      {/* Exit All Confirmation Modal */}
      {showExitConfirm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center sm:pb-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="exit-all-title"
            className="max-h-[min(90vh,520px)] w-full max-w-md overflow-y-auto rounded-xl border border-rose-500/30 bg-vz-card p-5 shadow-2xl"
          >
            <h3 id="exit-all-title" className="text-lg font-bold text-rose-300">
              Exit all positions?
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-vz-foreground">
              This will send <strong>market orders</strong> to close all {positions.length} open positions immediately.
            </p>
            <p className="mt-2 text-xs text-vz-muted">This cannot be undone. Auto-exit will stop.</p>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
              <button
                type="button"
                onClick={() => setShowExitConfirm(false)}
                className="min-h-[44px] w-full touch-manipulation rounded-lg border border-white/[0.12] px-4 py-2.5 text-sm text-vz-foreground hover:bg-white/[0.05] sm:w-auto"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => exitAllMutation.mutate()}
                disabled={exitAllMutation.isPending}
                className="min-h-[44px] w-full touch-manipulation rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-50 sm:w-auto"
              >
                {exitAllMutation.isPending ? "Exiting…" : "Confirm exit all"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
