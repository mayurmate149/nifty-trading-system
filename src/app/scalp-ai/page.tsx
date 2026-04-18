"use client";

/**
 * AI Scalp Signal Dashboard
 *
 * Real-time AI-powered scalping signals for NIFTY 50.
 * Auto-refreshes every 10 seconds.
 * Shows: Signal → Technicals → Factors → History
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ─── Types ────────────────────────────────────

interface SignalFactor {
  name: string;
  weight: number;
  score: number;
  direction: "BULL" | "BEAR" | "NEUTRAL";
  detail: string;
}

interface ScalpSignal {
  action: "BUY_CE" | "BUY_PE" | "SELL_CE" | "SELL_PE" | "NO_TRADE";
  confidence: number;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  strike: number;
  premium: number;
  stopLoss: number;
  target: number;
  atrSL: number;
  factors: SignalFactor[];
  rationale: string[];
  timestamp: string;
}

interface TechData {
  rsi: number;
  ema9: number;
  ema21: number;
  emaCrossover: string;
  vwap: number;
  priceVsVwap: string;
  atr: number;
  superTrend: number;
  superTrendSignal: string;
  momentum: number;
}

interface MarketData {
  spot: number;
  spotChange: number;
  spotChangePct: number;
  vix: number;
  pcr: number;
  ivPercentile: number;
  trend: string;
  trendStrength: number;
  support: number[];
  resistance: number[];
  pivotPoint: number;
}

interface SignalResponse {
  signal: ScalpSignal | null;
  technicals: TechData;
  market: MarketData;
  error?: string;
}

interface HistoryEntry {
  time: string;
  action: string;
  confidence: number;
  strike: number;
  premium: number;
}

// ─── Constants ────────────────────────────────

const ACTION_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  BUY_CE: { bg: "bg-emerald-900/40", text: "text-emerald-400", border: "border-emerald-600", label: "📈 BUY CALL" },
  BUY_PE: { bg: "bg-rose-900/40", text: "text-rose-400", border: "border-rose-600", label: "📉 BUY PUT" },
  SELL_CE: { bg: "bg-orange-900/40", text: "text-orange-400", border: "border-orange-600", label: "🔻 SELL CALL" },
  SELL_PE: { bg: "bg-cyan-900/40", text: "text-cyan-400", border: "border-cyan-600", label: "🔺 SELL PUT" },
  NO_TRADE: { bg: "bg-gray-800/60", text: "text-gray-400", border: "border-gray-700", label: "⏸️ NO TRADE" },
};

const FACTOR_DIR_COLOR: Record<string, string> = {
  BULL: "text-emerald-400",
  BEAR: "text-rose-400",
  NEUTRAL: "text-gray-500",
};

// ─── Page Component ──────────────────────────

export default function ScalpAIPage() {
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(10);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const prevActionRef = useRef<string>("");

  const { data, isLoading, isFetching, refetch } = useQuery<SignalResponse>({
    queryKey: ["scalp-signal"],
    queryFn: () => api.strategy.scalpSignal() as Promise<SignalResponse>,
    enabled: false,
    staleTime: 5000,
  });

  // Auto-refresh logic
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => refetch(), refreshInterval * 1000);
    return () => clearInterval(id);
  }, [autoRefresh, refreshInterval, refetch]);

  // Record history when signal changes
  useEffect(() => {
    if (!data?.signal || data.signal.action === "NO_TRADE") return;
    const sig = data.signal;
    const key = `${sig.action}-${sig.strike}-${sig.timestamp}`;
    if (key === prevActionRef.current) return;
    prevActionRef.current = key;

    setHistory((prev) => [
      {
        time: new Date(sig.timestamp).toLocaleTimeString(),
        action: sig.action,
        confidence: sig.confidence,
        strike: sig.strike,
        premium: sig.premium,
      },
      ...prev.slice(0, 19), // keep last 20
    ]);
  }, [data]);

  const signal = data?.signal ?? null;
  const tech = data?.technicals;
  const market = data?.market;
  const actionStyle = signal ? ACTION_STYLES[signal.action] ?? ACTION_STYLES.NO_TRADE : ACTION_STYLES.NO_TRADE;

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">🤖 AI Scalp Signal</h1>
          <p className="mt-1 text-sm text-gray-400">
            Multi-factor AI engine for NIFTY option scalping — 10 parameters, real-time
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-gray-500">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            Auto-refresh
          </label>
          {autoRefresh && (
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              className="rounded bg-gray-800 px-2 py-1 text-xs text-white"
            >
              <option value={5}>5s</option>
              <option value={10}>10s</option>
              <option value={15}>15s</option>
              <option value={30}>30s</option>
            </select>
          )}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-blue-500 disabled:opacity-50"
          >
            {isFetching ? "Reading…" : "📡 Get Signal"}
          </button>
        </div>
      </div>

      {/* Main Signal Card */}
      {signal && (
        <div className={`mb-6 rounded-xl border-2 p-6 ${actionStyle.bg} ${actionStyle.border}`}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className={`text-3xl font-black ${actionStyle.text}`}>
                {actionStyle.label}
              </div>
              <div className="mt-1 text-sm text-gray-400">
                Confidence: <span className="font-bold text-white">{signal.confidence}%</span>
                {" • "}Direction: <span className="font-bold text-white">{signal.direction}</span>
              </div>
            </div>
            {signal.action !== "NO_TRADE" && (
              <div className="grid grid-cols-2 gap-4 text-center sm:grid-cols-4">
                <MiniStat label="Strike" value={signal.strike.toString()} />
                <MiniStat label="Premium" value={`₹${signal.premium.toFixed(1)}`} />
                <MiniStat
                  label={signal.action.startsWith("SELL") ? "SL (exit at)" : "SL"}
                  value={`₹${signal.stopLoss.toFixed(1)}`}
                  negative
                />
                <MiniStat
                  label={signal.action.startsWith("SELL") ? "Target (decay to)" : "Target"}
                  value={`₹${signal.target.toFixed(1)}`}
                  positive
                />
              </div>
            )}
          </div>
          {/* ATR SL */}
          {signal.action !== "NO_TRADE" && (
            <div className="mt-3 text-xs text-gray-500">
              ATR-based Nifty SL: <span className="font-semibold text-gray-300">±{signal.atrSL} pts</span>
              {" • "}Lot Size: <span className="text-gray-300">75</span>
            </div>
          )}
        </div>
      )}

      {/* Loading placeholder */}
      {isLoading && !signal && (
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-900 p-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <span className="text-gray-400">Reading market data, computing technicals…</span>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !signal && (
        <div className="mb-6 rounded-lg border border-dashed border-gray-700 bg-gray-900/50 p-12 text-center">
          <p className="text-lg text-gray-500">
            Click &quot;📡 Get Signal&quot; to compute the AI scalp signal from live market data.
          </p>
          <p className="mt-2 text-sm text-gray-600">
            Uses: RSI · EMA 9/21 · VWAP · SuperTrend · ATR · OI · PCR · IV · S/R · Volume
          </p>
        </div>
      )}

      {/* Two Column: Technicals + Factors */}
      {signal && tech && market && (
        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          {/* Technical Parameters */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <h2 className="mb-4 text-sm font-bold uppercase text-gray-500">📊 Technical Parameters</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <ParamRow
                label="RSI (14)"
                value={tech.rsi.toFixed(1)}
                color={tech.rsi >= 60 ? "text-emerald-400" : tech.rsi <= 40 ? "text-rose-400" : "text-gray-300"}
              />
              <ParamRow
                label="EMA 9/21"
                value={tech.emaCrossover}
                color={tech.emaCrossover === "BULLISH" ? "text-emerald-400" : tech.emaCrossover === "BEARISH" ? "text-rose-400" : "text-gray-300"}
              />
              <ParamRow
                label="VWAP"
                value={`${tech.vwap.toFixed(0)} (${tech.priceVsVwap})`}
                color={tech.priceVsVwap === "ABOVE" ? "text-emerald-400" : tech.priceVsVwap === "BELOW" ? "text-rose-400" : "text-gray-300"}
              />
              <ParamRow
                label="SuperTrend"
                value={`${tech.superTrend.toFixed(0)} (${tech.superTrendSignal})`}
                color={tech.superTrendSignal === "BUY" ? "text-emerald-400" : "text-rose-400"}
              />
              <ParamRow label="ATR (14)" value={tech.atr.toFixed(1)} color="text-yellow-400" />
              <ParamRow
                label="Momentum"
                value={`${tech.momentum > 0 ? "+" : ""}${tech.momentum.toFixed(2)}%`}
                color={tech.momentum > 0 ? "text-emerald-400" : tech.momentum < 0 ? "text-rose-400" : "text-gray-300"}
              />
              <ParamRow label="VIX" value={market.vix.toFixed(1)} color="text-yellow-400" />
              <ParamRow label="PCR" value={market.pcr.toFixed(2)} color={market.pcr > 1 ? "text-emerald-400" : market.pcr < 0.8 ? "text-rose-400" : "text-gray-300"} />
              <ParamRow label="IV %ile" value={`${market.ivPercentile}%`} color="text-blue-400" />
              <ParamRow
                label="Trend"
                value={`${trendEmoji(market.trend)} ${market.trendStrength}%`}
                color="text-gray-300"
              />
              <ParamRow label="Spot" value={`${market.spot.toLocaleString("en-IN")} (${market.spotChangePct >= 0 ? "+" : ""}${market.spotChangePct.toFixed(2)}%)`} color={market.spotChangePct >= 0 ? "text-emerald-400" : "text-rose-400"} />
              <ParamRow label="Pivot" value={market.pivotPoint.toFixed(0)} color="text-gray-300" />
            </div>
          </div>

          {/* AI Factors Breakdown */}
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
            <h2 className="mb-4 text-sm font-bold uppercase text-gray-500">🧠 AI Factor Scores</h2>
            <div className="space-y-2">
              {signal.factors.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <div className="w-28 shrink-0 text-gray-500">{f.name}</div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 rounded-full bg-gray-800">
                        <div
                          className={`h-2 rounded-full ${
                            f.direction === "BULL"
                              ? "bg-emerald-500"
                              : f.direction === "BEAR"
                              ? "bg-rose-500"
                              : "bg-gray-600"
                          }`}
                          style={{ width: `${Math.min(100, (f.score / f.weight) * 100)}%` }}
                        />
                      </div>
                      <span className={`w-10 text-right text-xs font-bold ${FACTOR_DIR_COLOR[f.direction]}`}>
                        {f.score}/{f.weight}
                      </span>
                    </div>
                  </div>
                  <span className={`w-12 text-right text-xs ${FACTOR_DIR_COLOR[f.direction]}`}>
                    {f.direction === "BULL" ? "↑" : f.direction === "BEAR" ? "↓" : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Rationale */}
      {signal && signal.rationale.length > 0 && (
        <div className="mb-6 rounded-xl border border-gray-800 bg-gray-900 p-5">
          <h2 className="mb-3 text-sm font-bold uppercase text-gray-500">💡 AI Rationale</h2>
          <ul className="columns-1 gap-4 space-y-1 text-sm text-gray-300 sm:columns-2">
            {signal.rationale.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-blue-500">•</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Signal History */}
      {history.length > 0 && (
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
          <h2 className="mb-3 text-sm font-bold uppercase text-gray-500">
            📜 Signal History ({history.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-500">
                  <th className="pb-2 text-left font-normal">Time</th>
                  <th className="pb-2 text-left font-normal">Signal</th>
                  <th className="pb-2 text-right font-normal">Confidence</th>
                  <th className="pb-2 text-right font-normal">Strike</th>
                  <th className="pb-2 text-right font-normal">Premium</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => {
                  const style = ACTION_STYLES[h.action] ?? ACTION_STYLES.NO_TRADE;
                  return (
                    <tr key={i} className="border-b border-gray-800/50">
                      <td className="py-1.5 text-gray-400">{h.time}</td>
                      <td className={`py-1.5 font-medium ${style.text}`}>{h.action.replace(/_/g, " ")}</td>
                      <td className="py-1.5 text-right">{h.confidence}%</td>
                      <td className="py-1.5 text-right text-white">{h.strike}</td>
                      <td className="py-1.5 text-right">₹{h.premium.toFixed(1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────

function MiniStat({
  label,
  value,
  positive,
  negative,
}: {
  label: string;
  value: string;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-lg font-bold ${positive ? "text-green-400" : negative ? "text-red-400" : "text-white"}`}>
        {value}
      </div>
    </div>
  );
}

function ParamRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between rounded bg-gray-800/40 px-3 py-2">
      <span className="text-gray-500">{label}</span>
      <span className={`font-semibold ${color}`}>{value}</span>
    </div>
  );
}

function trendEmoji(trend: string): string {
  return trend === "trend-up" ? "📈" : trend === "trend-down" ? "📉" : "↔️";
}
