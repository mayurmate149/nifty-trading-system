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
import { useState, useEffect, useRef } from "react";

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
  if (!res.ok) throw new Error("Failed to exit all positions");
  return res.json();
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

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-400">Loading positions...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-red-400">Error loading positions</p>
      </div>
    );
  }

  const posBlock = data?.positions;
  const positions = (posBlock?.positions ?? []).filter((p: Position) => p.status === "OPEN");
  const margin = posBlock?.margin ?? null;
  const funds = posBlock?.fundsBreakdown ?? null;
  const brokerMargin = (margin && margin.usedMargin > 0) ? margin.usedMargin : 0;
  const positionSum = positions.reduce((sum, p) => sum + p.capitalDeployed, 0);
  const totalCapital = brokerMargin > 0 ? brokerMargin : positionSum;

  // Parse nearest expiry from position symbols (e.g. "NIFTY 21 Apr 2026 PE 23600.00")
  const expiryInfo = (() => {
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
    // Count only trading days (exclude Sat & Sun)
    let daysRemaining = 0;
    const cursor = new Date(today);
    while (cursor < nearest) {
      cursor.setDate(cursor.getDate() + 1);
      const day = cursor.getDay();
      if (day !== 0 && day !== 6) daysRemaining++;
    }
    return { date: nearest, daysRemaining };
  })();

  return (
    <div className="mx-auto max-w-7xl p-6">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold">📊 Active Positions</h1>
        <div className="flex items-center gap-4">
          {positions.length > 0 && (
            <button
              onClick={() => setShowExitConfirm(true)}
              disabled={exitAllMutation.isPending}
              className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {exitAllMutation.isPending ? "Exiting..." : "🔴 Exit All"}
            </button>
          )}
          <button
            onClick={() => toggleMutation.mutate(engineRunning ? "disable" : "enable")}
            disabled={toggleMutation.isPending}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition ${
              engineRunning
                ? "bg-red-600 hover:bg-red-500"
                : "bg-yellow-600 hover:bg-yellow-500"
            } ${toggleMutation.isPending ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {toggleMutation.isPending
              ? "..."
              : engineRunning
              ? `🛑 Disable Auto-Exit (${watchedCount})`
              : "⚡ Enable Auto-Exit"}
          </button>
          <div className="text-sm text-gray-400">
            {positions.length} open positions · Auto-refreshing
            {expiryInfo && (
              <span className={`ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${
                expiryInfo.daysRemaining === 0
                  ? "bg-red-900/50 text-red-400"
                  : expiryInfo.daysRemaining <= 1
                  ? "bg-orange-900/50 text-orange-400"
                  : "bg-gray-800 text-gray-400"
              }`}>
                ⏳ {expiryInfo.daysRemaining === 0 ? "Expiry TODAY" : `${expiryInfo.daysRemaining}D to expiry`}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Market Header */}
      <MarketHeader indicators={mergedIndicators ?? null} />

      {/* Engine Status Banner */}
      {/* Trailing SL Status */}
      {engineRunning && autoExitData?.portfolio && (
        <div className="mb-6 rounded-lg border border-blue-800 bg-blue-950/30 p-4">
          <div className="flex items-center gap-2 mb-3 text-xs text-green-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500"></span>
            </span>
            Engine running · {watchedCount} positions · 🔒 Server-side
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div>
                <div className="text-xs text-blue-400 uppercase tracking-wider">Active Trailing SL</div>
                <div className={`text-3xl font-bold ${
                  autoExitData.portfolio.currentTrailingSLPct >= 0 ? "text-green-400" : "text-red-400"
                }`}>
                  {autoExitData.portfolio.currentTrailingSLPct >= 0 ? "+" : ""}{autoExitData.portfolio.currentTrailingSLPct.toFixed(1)}%
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Exit triggers at ₹{(totalCapital * autoExitData.portfolio.currentTrailingSLPct / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })} P&L
                </div>
              </div>
              <div className="h-12 w-px bg-blue-800" />
              <div>
                <div className="text-xs text-blue-400 uppercase tracking-wider">Peak P&L</div>
                <div className="text-2xl font-bold text-blue-300">
                  +{autoExitData.portfolio.peakPnlPct.toFixed(2)}%
                </div>
              </div>
              <div className="h-12 w-px bg-blue-800" />
              <div>
                <div className="text-xs text-blue-400 uppercase tracking-wider">Status</div>
                <div className="text-sm font-medium text-gray-300 mt-1">
                  {autoExitData.portfolio.currentTrailingSLPct < 0 && "🔴 Stop-Loss active"}
                  {autoExitData.portfolio.currentTrailingSLPct === 0 && "⚪ At breakeven"}
                  {autoExitData.portfolio.currentTrailingSLPct > 0 && autoExitData.portfolio.currentTrailingSLPct < 2 && "🟡 Profit locked"}
                  {autoExitData.portfolio.currentTrailingSLPct >= 2 && "🟢 Profit floor secured"}
                </div>
                <div className="text-[10px] text-gray-500 mt-0.5">
                  SL only moves up, never down
                </div>
              </div>
              {expiryInfo && (
                <>
                  <div className="h-12 w-px bg-blue-800" />
                  <div>
                    <div className="text-xs text-blue-400 uppercase tracking-wider">Expiry</div>
                    <div className={`text-2xl font-bold mt-0.5 ${
                      expiryInfo.daysRemaining === 0
                        ? "text-red-400"
                        : expiryInfo.daysRemaining <= 1
                        ? "text-orange-400"
                        : expiryInfo.daysRemaining <= 3
                        ? "text-yellow-400"
                        : "text-gray-300"
                    }`}>
                      {expiryInfo.daysRemaining === 0 ? "TODAY" : `${expiryInfo.daysRemaining}D Left`}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      {expiryInfo.date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })} · trading days
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="text-right text-xs text-gray-500 space-y-0.5">
              <div>Initial: −1%</div>
              <div>Trail offset: 1%</div>
              <div>Profit floor: 2%</div>
            </div>
          </div>
        </div>
      )}

      {/* Risk Summary */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-6">
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <div className="text-sm text-gray-400">Margin Required</div>
          <div className="text-xl font-bold">
            ₹{brokerMargin.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </div>
          {funds && funds.spreadMargin > 0 && (
            <div className="text-xs text-gray-500 mt-1">
              Spread: ₹{funds.spreadMargin.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </div>
          )}
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <div className="text-sm text-gray-400">Premiums</div>
          <div className="text-xl font-bold text-gray-300">
            ₹{(funds?.netPremium ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            <span className="text-xs text-gray-500 ml-1">net</span>
          </div>
          <div className="text-xs text-gray-500 mt-1">
            Sell: ₹{(funds?.sellPremium ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })} | Buy: ₹{(funds?.buyPremium ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </div>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <div className="text-sm text-gray-400">Total P&L</div>
          {(() => {
            const totalPnl = positions.reduce((s, p) => s + p.pl, 0);
            const pnlPct = totalCapital > 0 ? (totalPnl / totalCapital) * 100 : 0;
            return (
              <>
                <div className={`text-xl font-bold ${totalPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                  ₹{totalPnl.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </div>
                <div className={`text-xs mt-1 ${pnlPct >= 0 ? "text-green-500" : "text-red-500"}`}>
                  {pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}% of capital
                </div>
              </>
            );
          })()}
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <div className="text-sm text-gray-400">Capital for SL</div>
          <div className="text-xl font-bold text-purple-400">
            ₹{totalCapital.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {brokerMargin > 0 ? "from margin" : "from positions"}
          </div>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <div className="text-sm text-gray-400">Max Loss (SL 1%)</div>
          <div className="text-xl font-bold text-yellow-400">
            ₹{(totalCapital * 0.01).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </div>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <div className="text-sm text-gray-400">Profit Floor (2%)</div>
          <div className="text-xl font-bold text-blue-400">
            ₹{(totalCapital * 0.02).toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </div>
        </div>
      </div>

      {/* Positions Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-900 text-gray-400">
            <tr>
              <th className="px-4 py-3 text-left">Symbol</th>
              <th className="px-4 py-3 text-right">Strike</th>
              <th className="px-4 py-3 text-center">Type</th>
              <th className="px-4 py-3 text-center">Side</th>
              <th className="px-4 py-3 text-right">Qty</th>
              <th className="px-4 py-3 text-right">Avg Price</th>
              <th className="px-4 py-3 text-right">LTP</th>
              <th className="px-4 py-3 text-right">P&L</th>
              <th className="px-4 py-3 text-right">Premium</th>
              {engineRunning && <th className="px-4 py-3 text-center">Watch</th>}
            </tr>
          </thead>
          <tbody>
            {positions.map((pos) => {
              const watchState = autoExitData?.watched?.find(
                (w: any) => w.positionId === pos.positionId
              );
              const isBuy = pos.quantity > 0;
              // Parse strike from symbol if strike field is 0 (e.g. "NIFTY 21 Apr 2026 PE 23600.00")
              const displayStrike = pos.strike > 0
                ? pos.strike
                : (() => {
                    const m = pos.symbol.match(/(CE|PE)\s+([\d.]+)/i);
                    return m ? parseFloat(m[2]) : 0;
                  })();
              return (
                <tr key={pos.positionId} className="border-t border-gray-800 hover:bg-gray-900/50">
                  <td className="px-4 py-3 font-medium">{pos.symbol}</td>
                  <td className="px-4 py-3 text-right">{displayStrike > 0 ? displayStrike : "—"}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                      pos.optionType === "CALL" ? "bg-green-900/50 text-green-400" : "bg-red-900/50 text-red-400"
                    }`}>
                      {pos.optionType}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${
                      isBuy ? "bg-blue-900/50 text-blue-400" : "bg-orange-900/50 text-orange-400"
                    }`}>
                      {isBuy ? "BUY" : "SELL"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">{Math.abs(pos.quantity)}</td>
                  <td className="px-4 py-3 text-right">₹{pos.avgPrice.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right">₹{pos.ltp.toFixed(2)}</td>
                  <td className={`px-4 py-3 text-right font-medium ${pos.pl >= 0 ? "text-green-400" : "text-red-400"}`}>
                    ₹{pos.pl.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right">₹{pos.capitalDeployed.toLocaleString()}</td>
                  {engineRunning && (
                    <td className="px-4 py-3 text-center">
                      {watchState ? (
                        <span className="flex items-center justify-center gap-1 text-xs text-green-400">
                          <span className="inline-block h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
                          SL: {(autoExitData?.portfolio?.currentTrailingSLPct ?? watchState.currentSLPercent).toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500">—</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Event Log */}
      {(engineRunning || eventLog.length > 0) && (
        <div className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              📋 Auto-Exit Event Log
              {tradingOverWs && (
                <span className="ml-2 text-xs font-normal text-emerald-500/90">(WebSocket)</span>
              )}
            </h2>
            {!tradingOverWs && eventLog.length > 0 && (
              <button
                onClick={() => setSseEventLog([])}
                className="text-xs text-gray-500 hover:text-gray-300"
              >
                Clear
              </button>
            )}
          </div>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-800 bg-gray-900/50">
            {eventLog.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-gray-500">
                No events yet. Engine is monitoring positions...
              </div>
            ) : (
              eventLog.map((evt, i) => (
                <div
                  key={`${evt.timestamp}-${i}`}
                  className="flex items-start gap-3 border-b border-gray-800/50 px-4 py-2 last:border-0"
                >
                  <span className="mt-0.5 text-base">
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
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-200 truncate">{evt.message}</div>
                    <div className="text-xs text-gray-500">
                      {new Date(evt.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium ${
                    evt.type === "STOP_LOSS" ? "bg-red-900/50 text-red-400"
                    : evt.type === "TAKE_PROFIT" ? "bg-green-900/50 text-green-400"
                    : evt.type === "TRAIL_UPDATE" ? "bg-blue-900/50 text-blue-400"
                    : "bg-gray-800 text-gray-400"
                  }`}>
                    {evt.type}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
      {/* Exit All Confirmation Modal */}
      {showExitConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="rounded-xl border border-red-800 bg-gray-900 p-6 shadow-2xl max-w-md w-full mx-4">
            <h3 className="text-lg font-bold text-red-400 mb-2">⚠️ Exit All Positions</h3>
            <p className="text-sm text-gray-300 mb-1">
              This will place <strong>market orders</strong> to square off all {positions.length} open positions immediately.
            </p>
            <p className="text-xs text-gray-500 mb-4">
              This action cannot be undone. The auto-exit engine will also be stopped.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowExitConfirm(false)}
                className="rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => exitAllMutation.mutate()}
                disabled={exitAllMutation.isPending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 transition disabled:opacity-50"
              >
                {exitAllMutation.isPending ? "Exiting..." : "Confirm Exit All"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
