"use client";

/**
 * Auto-Scanner Dashboard — Intraday NIFTY Options Trade Finder
 *
 * Continuously monitors the options chain and displays:
 *   - The SINGLE BEST trade with win probability, EV, legs
 *   - Market bias meter (BULLISH / BEARISH / NEUTRAL)
 *   - OI walls, expected move, ATM straddle
 *   - 3 alternate trade suggestions
 *   - Trade history log
 *
 * Auto-refreshes every 8 seconds (configurable).
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ─── Types (mirrors server) ─────────────────

interface ScanLeg {
  action: "BUY" | "SELL";
  optionType: "CE" | "PE";
  strike: number;
  premium: number;
  iv: number;
  delta: number;
  oi: number;
  changeInOi: number;
  volume: number;
}

interface ScanTrade {
  id: string;
  tradeType: string;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  legs: ScanLeg[];
  netCredit: number;
  maxProfit: number;
  maxLoss: number;
  breakeven: number[];
  marginRequired: number;
  winProbability: number;
  expectedValue: number;
  riskReward: number;
  kellyScore: number;
  score: number;
  edge: string;
  rationale: string[];
  warnings: string[];
  oiWall: string;
  thetaDecayPerDay: number;
  targetTime: string;
}

interface ScanResult {
  bestTrade: ScanTrade | null;
  alternates: ScanTrade[];
  marketBias: "BULLISH" | "BEARISH" | "NEUTRAL";
  biasStrength: number;
  scanTimestamp: string;
  marketContext: {
    spot: number;
    vix: number;
    pcr: number;
    trend: string;
    trendStrength: number;
    ivPercentile: number;
    maxCallOI: { strike: number; oi: number };
    maxPutOI: { strike: number; oi: number };
    atmIV: number;
    atmStraddle: number;
    expectedMove: number;
  };
  error?: string;
}

interface HistoryEntry {
  time: string;
  tradeType: string;
  direction: string;
  edge: string;
  winProb: number;
  ev: number;
  score: number;
}

// ─── Constants ──────────────────────────────

const REFRESH_OPTIONS = [
  { label: "5s", value: 5000 },
  { label: "8s", value: 8000 },
  { label: "15s", value: 15000 },
  { label: "30s", value: 30000 },
  { label: "Off", value: 0 },
];

const BIAS_COLORS = {
  BULLISH: { bg: "bg-emerald-900/30", border: "border-emerald-600", text: "text-emerald-400", icon: "🟢" },
  BEARISH: { bg: "bg-rose-900/30", border: "border-rose-600", text: "text-rose-400", icon: "🔴" },
  NEUTRAL: { bg: "bg-blue-900/30", border: "border-blue-600", text: "text-blue-400", icon: "🔵" },
};

const TRADE_TYPE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  SELL_PE: { label: "Sell Put", icon: "🟢", color: "text-emerald-400" },
  SELL_CE: { label: "Sell Call", icon: "🔴", color: "text-rose-400" },
  BULL_PUT_SPREAD: { label: "Bull Put Spread", icon: "📈", color: "text-emerald-400" },
  BEAR_CALL_SPREAD: { label: "Bear Call Spread", icon: "📉", color: "text-rose-400" },
  SHORT_STRANGLE: { label: "Short Strangle", icon: "🔀", color: "text-blue-400" },
  IRON_CONDOR: { label: "Iron Condor", icon: "🦅", color: "text-blue-400" },
  BUY_CE: { label: "Buy Call", icon: "🚀", color: "text-emerald-400" },
  BUY_PE: { label: "Buy Put", icon: "💥", color: "text-rose-400" },
};

// ─── Component ──────────────────────────────

export default function AutoScannerPage() {
  const [refreshInterval, setRefreshInterval] = useState(8000);
  const [capital, setCapital] = useState(200000);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [scanCount, setScanCount] = useState(0);
  const lastTradeRef = useRef<string | null>(null);

  const { data, isLoading, isFetching, error } = useQuery<ScanResult>({
    queryKey: ["auto-scan", capital],
    queryFn: () => api.strategy.autoScan(capital) as Promise<ScanResult>,
    refetchInterval: refreshInterval || false,
    staleTime: 4000,
  });

  // Track history when best trade changes
  useEffect(() => {
    if (!data?.bestTrade) return;
    const trade = data.bestTrade;
    if (trade.id === lastTradeRef.current) return;
    lastTradeRef.current = trade.id;
    setScanCount((c) => c + 1);
    setHistory((prev) => [
      {
        time: new Date().toLocaleTimeString("en-IN"),
        tradeType: trade.tradeType,
        direction: trade.direction,
        edge: trade.edge,
        winProb: trade.winProbability,
        ev: trade.expectedValue,
        score: trade.score,
      },
      ...prev.slice(0, 19), // keep last 20
    ]);
  }, [data?.bestTrade?.id]);

  const ctx = data?.marketContext;
  const best = data?.bestTrade;

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      {/* ─── Header ──────────────────────────── */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            🔍 Auto-Scanner
            {isFetching && <span className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-green-400" />}
          </h1>
          <p className="mt-1 text-sm text-gray-400">
            Continuously scanning NIFTY 50 chain for the <span className="font-semibold text-yellow-400">best 2% daily trade</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Capital input */}
          <label className="text-xs text-gray-500">
            Capital ₹
            <input
              type="number"
              value={capital}
              onChange={(e) => setCapital(Number(e.target.value) || 200000)}
              className="ml-1 w-24 rounded bg-gray-800 px-2 py-1 text-sm text-white"
              step={50000}
              min={50000}
            />
          </label>
          {/* Refresh interval */}
          <div className="flex gap-1">
            {REFRESH_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setRefreshInterval(opt.value)}
                className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                  refreshInterval === opt.value
                    ? "bg-yellow-600 text-white"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-gray-600">Scans: {scanCount}</span>
        </div>
      </div>

      {/* ─── Market Context Bar ──────────────── */}
      {ctx && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <CtxPill label="NIFTY" value={ctx.spot.toFixed(0)} />
          <CtxPill label="VIX" value={ctx.vix.toFixed(1)} />
          <CtxPill label="PCR" value={ctx.pcr.toFixed(2)} />
          <CtxPill label="Trend" value={ctx.trend.replace("trend-", "").replace("range-bound", "sideways")} />
          <CtxPill label="IV Pctl" value={`${ctx.ivPercentile}%`} />
          <CtxPill label="ATM Straddle" value={`₹${ctx.atmStraddle}`} />
          <CtxPill label="Exp. Move" value={`±${ctx.expectedMove} pts`} />
          <CtxPill label="ATM IV" value={`${ctx.atmIV.toFixed(1)}%`} />
        </div>
      )}

      {/* ─── Market Bias Meter ───────────────── */}
      {data && (
        <div className={`mb-6 rounded-lg border p-4 ${BIAS_COLORS[data.marketBias].bg} ${BIAS_COLORS[data.marketBias].border}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-3xl">{BIAS_COLORS[data.marketBias].icon}</span>
              <div>
                <div className={`text-xl font-bold ${BIAS_COLORS[data.marketBias].text}`}>
                  Market Bias: {data.marketBias}
                </div>
                <div className="text-sm text-gray-400">
                  Strength: {data.biasStrength}% — based on EMA, SuperTrend, VWAP, RSI, PCR, Trend
                </div>
              </div>
            </div>
            {/* OI Walls */}
            {ctx && (
              <div className="hidden text-right text-xs text-gray-400 sm:block">
                <div>🟢 Max PE OI: {ctx.maxPutOI.strike} ({formatLakh(ctx.maxPutOI.oi)})</div>
                <div>🔴 Max CE OI: {ctx.maxCallOI.strike} ({formatLakh(ctx.maxCallOI.oi)})</div>
                <div className="mt-1 text-gray-500">
                  Range: {ctx.maxPutOI.strike} — {ctx.maxCallOI.strike} ({ctx.maxCallOI.strike - ctx.maxPutOI.strike} pts)
                </div>
              </div>
            )}
          </div>
          {/* Bias bar */}
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-700">
            <div
              className={`h-full transition-all duration-500 ${
                data.marketBias === "BULLISH"
                  ? "bg-emerald-500"
                  : data.marketBias === "BEARISH"
                  ? "bg-rose-500"
                  : "bg-blue-500"
              }`}
              style={{ width: `${Math.max(10, data.biasStrength)}%` }}
            />
          </div>
        </div>
      )}

      {/* ─── Loading State ───────────────────── */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-yellow-500 border-t-transparent" />
            <p className="text-gray-400">Scanning {">"}200 strikes across 8 strategies...</p>
          </div>
        </div>
      )}

      {/* ─── Error State ─────────────────────── */}
      {data?.error && !best && (
        <div className="rounded-lg border border-red-800 bg-red-900/20 p-6 text-center">
          <p className="text-red-400">⚠️ {data.error}</p>
        </div>
      )}

      {/* ─── No Trade Found ──────────────────── */}
      {data && !data.error && !best && !isLoading && (
        <div className="rounded-lg border border-yellow-800 bg-yellow-900/20 p-6 text-center">
          <p className="text-xl">🚫 No Positive-EV Trade Found</p>
          <p className="mt-2 text-sm text-gray-400">
            All scanned trades have negative expected value in current conditions.
            Market may be too volatile or premiums too thin.
          </p>
        </div>
      )}

      {/* ─── Best Trade Card ─────────────────── */}
      {best && <BestTradeCard trade={best} capital={capital} />}

      {/* ─── Alternates ──────────────────────── */}
      {data?.alternates && data.alternates.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-3 text-lg font-semibold text-gray-300">📋 Alternative Trades</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.alternates.map((trade) => (
              <AlternateCard key={trade.id} trade={trade} />
            ))}
          </div>
        </div>
      )}

      {/* ─── Signal History ──────────────────── */}
      {history.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-semibold text-gray-300">📜 Scan History</h2>
          <div className="max-h-64 overflow-auto rounded-lg border border-gray-800 bg-gray-900/60">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-900">
                <tr className="text-gray-500">
                  <th className="px-3 py-2 text-left">Time</th>
                  <th className="px-3 py-2 text-left">Trade</th>
                  <th className="px-3 py-2 text-left">Direction</th>
                  <th className="px-3 py-2 text-right">Win %</th>
                  <th className="px-3 py-2 text-right">EV ₹</th>
                  <th className="px-3 py-2 text-right">Score</th>
                  <th className="px-3 py-2 text-left">Edge</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => {
                  const tt = TRADE_TYPE_LABELS[h.tradeType] || { icon: "?", label: h.tradeType, color: "text-gray-400" };
                  return (
                    <tr key={i} className="border-t border-gray-800 hover:bg-gray-800/50">
                      <td className="px-3 py-1.5 text-gray-500">{h.time}</td>
                      <td className={`px-3 py-1.5 font-medium ${tt.color}`}>{tt.icon} {tt.label}</td>
                      <td className="px-3 py-1.5">
                        <span className={
                          h.direction === "BULLISH" ? "text-emerald-400" :
                          h.direction === "BEARISH" ? "text-rose-400" : "text-blue-400"
                        }>
                          {h.direction}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">{h.winProb}%</td>
                      <td className={`px-3 py-1.5 text-right font-mono ${h.ev >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {h.ev >= 0 ? "+" : ""}₹{h.ev.toLocaleString("en-IN")}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">{h.score}</td>
                      <td className="max-w-[200px] truncate px-3 py-1.5 text-xs text-gray-500">{h.edge}</td>
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

// ─── Best Trade Card ────────────────────────

function BestTradeCard({ trade, capital }: { trade: ScanTrade; capital: number }) {
  const tt = TRADE_TYPE_LABELS[trade.tradeType] || { icon: "?", label: trade.tradeType, color: "text-gray-400" };
  const evPositive = trade.expectedValue >= 0;
  const target2Pct = capital * 0.02;
  const hitsTarget = trade.maxProfit >= target2Pct;

  return (
    <div className="rounded-xl border-2 border-yellow-600 bg-gradient-to-br from-gray-900 to-gray-800 p-5 shadow-lg shadow-yellow-600/10">
      {/* Header */}
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">{tt.icon}</span>
            <h2 className={`text-xl font-bold ${tt.color}`}>{tt.label}</h2>
            <span className={`rounded px-2 py-0.5 text-xs font-semibold ${
              trade.direction === "BULLISH" ? "bg-emerald-900/50 text-emerald-400" :
              trade.direction === "BEARISH" ? "bg-rose-900/50 text-rose-400" :
              "bg-blue-900/50 text-blue-400"
            }`}>
              {trade.direction}
            </span>
          </div>
          <p className="mt-1 text-sm text-yellow-400">{trade.edge}</p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-yellow-400">{trade.score}</div>
          <div className="text-xs text-gray-500">score</div>
        </div>
      </div>

      {/* Win Probability + EV + R:R — the 3 key metrics */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <MetricBox
          label="Win Probability"
          value={`${trade.winProbability}%`}
          color={trade.winProbability >= 70 ? "text-green-400" : trade.winProbability >= 55 ? "text-yellow-400" : "text-red-400"}
          sub={`Delta-derived`}
        />
        <MetricBox
          label="Expected Value"
          value={`${evPositive ? "+" : ""}₹${trade.expectedValue.toLocaleString("en-IN")}`}
          color={evPositive ? "text-green-400" : "text-red-400"}
          sub="per lot"
        />
        <MetricBox
          label="Risk : Reward"
          value={`1 : ${trade.riskReward.toFixed(1)}`}
          color={trade.riskReward >= 0.4 ? "text-blue-400" : "text-orange-400"}
          sub={`Max P: ₹${trade.maxProfit.toLocaleString("en-IN")}`}
        />
      </div>

      {/* Legs */}
      <div className="mb-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-400">TRADE LEGS</h3>
        <div className="space-y-1.5">
          {trade.legs.map((leg, i) => (
            <div key={i} className="flex items-center justify-between rounded bg-gray-800/80 px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${
                  leg.action === "SELL" ? "bg-red-900/60 text-red-400" : "bg-green-900/60 text-green-400"
                }`}>
                  {leg.action}
                </span>
                <span className="font-mono font-semibold text-white">{leg.strike} {leg.optionType}</span>
              </div>
              <div className="flex items-center gap-4 text-xs text-gray-400">
                <span>LTP: <span className="font-mono text-white">₹{leg.premium}</span></span>
                <span>IV: <span className="font-mono">{leg.iv.toFixed(1)}%</span></span>
                <span>Δ: <span className="font-mono">{leg.delta.toFixed(2)}</span></span>
                <span>OI: <span className="font-mono">{formatLakh(leg.oi)}</span></span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Financial summary */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <FinBox label="Net Credit" value={`₹${trade.netCredit}`} positive={trade.netCredit > 0} />
        <FinBox label="Max Profit" value={`₹${trade.maxProfit.toLocaleString("en-IN")}`} positive />
        <FinBox label="Max Loss" value={`₹${trade.maxLoss.toLocaleString("en-IN")}`} positive={false} />
        <FinBox label="Margin Req." value={`₹${trade.marginRequired.toLocaleString("en-IN")}`} />
      </div>

      {/* Breakeven + Target */}
      <div className="mb-4 flex flex-wrap gap-3 text-xs">
        <span className="rounded bg-gray-800 px-2 py-1 text-gray-400">
          🎯 Breakeven: {trade.breakeven.map((b) => b.toFixed(0)).join(" / ")}
        </span>
        <span className="rounded bg-gray-800 px-2 py-1 text-gray-400">
          ⏱️ Time: {trade.targetTime}
        </span>
        <span className="rounded bg-gray-800 px-2 py-1 text-gray-400">
          📉 θ Decay: ₹{trade.thetaDecayPerDay}/day
        </span>
        {hitsTarget && (
          <span className="rounded bg-yellow-900/50 px-2 py-1 font-semibold text-yellow-400">
            ✅ Hits 2% target (₹{target2Pct.toLocaleString("en-IN")})
          </span>
        )}
      </div>

      {/* OI Wall */}
      {trade.oiWall && (
        <div className="mb-3 rounded bg-gray-800/60 px-3 py-2 text-xs text-gray-400">
          🧱 <span className="font-semibold text-gray-300">OI Walls:</span> {trade.oiWall}
        </div>
      )}

      {/* Rationale */}
      {trade.rationale.length > 0 && (
        <div className="mb-3">
          <h3 className="mb-1 text-xs font-semibold text-gray-500">WHY THIS TRADE</h3>
          <ul className="space-y-0.5 text-xs text-gray-400">
            {trade.rationale.map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings */}
      {trade.warnings.length > 0 && (
        <div className="rounded border border-orange-800 bg-orange-900/20 px-3 py-2">
          {trade.warnings.map((w, i) => (
            <p key={i} className="text-xs text-orange-400">{w}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Alternate Trade Card ───────────────────

function AlternateCard({ trade }: { trade: ScanTrade }) {
  const tt = TRADE_TYPE_LABELS[trade.tradeType] || { icon: "?", label: trade.tradeType, color: "text-gray-400" };

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900/60 p-4 transition-colors hover:border-gray-600">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span>{tt.icon}</span>
          <span className={`font-semibold ${tt.color}`}>{tt.label}</span>
        </div>
        <span className="rounded bg-gray-800 px-2 py-0.5 text-sm font-bold text-yellow-400">{trade.score}</span>
      </div>

      {/* Legs summary */}
      <div className="mb-2 space-y-0.5 text-xs">
        {trade.legs.map((leg, i) => (
          <div key={i} className="flex gap-2">
            <span className={leg.action === "SELL" ? "text-red-400" : "text-green-400"}>{leg.action}</span>
            <span className="font-mono text-white">{leg.strike}{leg.optionType}</span>
            <span className="text-gray-500">@₹{leg.premium}</span>
          </div>
        ))}
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-3 gap-1 text-xs">
        <div>
          <div className="text-gray-500">Win %</div>
          <div className={`font-mono font-semibold ${trade.winProbability >= 65 ? "text-green-400" : "text-yellow-400"}`}>
            {trade.winProbability}%
          </div>
        </div>
        <div>
          <div className="text-gray-500">EV</div>
          <div className={`font-mono font-semibold ${trade.expectedValue >= 0 ? "text-green-400" : "text-red-400"}`}>
            {trade.expectedValue >= 0 ? "+" : ""}₹{trade.expectedValue}
          </div>
        </div>
        <div>
          <div className="text-gray-500">Profit</div>
          <div className="font-mono font-semibold text-white">₹{trade.maxProfit.toLocaleString("en-IN")}</div>
        </div>
      </div>

      <p className="mt-2 truncate text-xs text-gray-500">{trade.edge}</p>
    </div>
  );
}

// ─── Small Components ───────────────────────

function CtxPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-800/60 px-3 py-2 text-center">
      <div className="text-[10px] uppercase text-gray-500">{label}</div>
      <div className="font-mono text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function MetricBox({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-gray-800/80 p-3 text-center">
      <div className="text-[10px] uppercase text-gray-500">{label}</div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-600">{sub}</div>}
    </div>
  );
}

function FinBox({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="rounded bg-gray-800/60 px-3 py-2">
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className={`font-mono text-sm font-semibold ${
        positive === true ? "text-green-400" : positive === false ? "text-red-400" : "text-white"
      }`}>
        {value}
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────

function formatLakh(n: number): string {
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(1)}Cr`;
  if (n >= 100_000) return `${(n / 100_000).toFixed(1)}L`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}
