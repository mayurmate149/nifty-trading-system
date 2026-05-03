"use client";

/**
 * Trade Suggestions Page — Options SELLER Focused
 *
 * Phase 6: Strategy scanner for NIFTY 50.
 * Primary: Seller strategies (Iron Condor, Credit Spread, Short Straddle, Short Iron Fly)
 * Secondary: Buyer strategies (Debit Spread, Directional Buy) — only extreme conditions
 */

import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  StrategyType,
  TradeSuggestion,
  SuggestResponse,
  STRATEGY_META,
} from "@/types/strategy";
import { api } from "@/lib/api";

const STRATEGIES: { value: StrategyType | "ALL"; label: string; icon: string; seller: boolean }[] = [
  { value: "ALL", label: "All Strategies", icon: "🔍", seller: true },
  // ─── CREDIT (seller) ───
  { value: "BULL_PUT_SPREAD", label: "Bull Put Spread", icon: "🟢", seller: true },
  { value: "BEAR_CALL_SPREAD", label: "Bear Call Spread", icon: "🔴", seller: true },
  { value: "IRON_FLY", label: "Iron Fly", icon: "🦋", seller: true },
  { value: "SHORT_IRON_CONDOR", label: "Short Iron Condor", icon: "🦅", seller: true },
  // ─── DEBIT (buyer) ───
  { value: "BULL_CALL_SPREAD", label: "Bull Call Spread", icon: "📈", seller: false },
  { value: "BEAR_PUT_SPREAD", label: "Bear Put Spread", icon: "📉", seller: false },
  { value: "DIRECTIONAL_BUY", label: "Directional Buy", icon: "🎯", seller: false },
  { value: "NAKED_BUY", label: "Naked Buy CE/PE", icon: "🚀", seller: false },
];

const SELLER_SET = new Set<string>([
  "BULL_PUT_SPREAD",
  "BEAR_CALL_SPREAD",
  "IRON_FLY",
  "SHORT_IRON_CONDOR",
]);

const TIER_COLORS: Record<string, string> = {
  HIGH: "bg-green-900/50 text-green-400 border-green-700",
  MEDIUM: "bg-yellow-900/50 text-yellow-400 border-yellow-700",
  LOW: "bg-red-900/50 text-red-400 border-red-700",
};

const DIRECTION_BADGE: Record<string, { bg: string; text: string }> = {
  BULLISH: { bg: "bg-emerald-900/40", text: "text-emerald-400" },
  BEARISH: { bg: "bg-rose-900/40", text: "text-rose-400" },
  NEUTRAL: { bg: "bg-blue-900/40", text: "text-blue-400" },
};

export default function TradeSuggestionsPage() {
  const [selected, setSelected] = useState<StrategyType | "ALL">("ALL");
  const [threshold, setThreshold] = useState(50);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const {
    data,
    isLoading,
    isFetching,
    refetch,
  } = useQuery<SuggestResponse>({
    queryKey: ["suggestions", selected, threshold],
    queryFn: () =>
      api.strategy.suggest({
        symbol: "NIFTY",
        strategies: selected === "ALL" ? [] : [selected],
        riskParams: {
          maxCapitalPercent: 5.0,
          confidenceThreshold: threshold,
          lotSize: 75,
        },
      }) as Promise<SuggestResponse>,
    enabled: false,
    staleTime: 30_000,
  });

  const handleScan = useCallback(() => {
    refetch();
  }, [refetch]);

  const suggestions: TradeSuggestion[] = data?.suggestions ?? [];
  const snapshot = data?.marketSnapshot;

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">🎯 Trade Suggestions</h1>
          <p className="mt-1 text-sm text-gray-400">
            Options <span className="font-semibold text-orange-400">SELLER</span>-focused strategy scanner for NIFTY 50
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-xs text-gray-500">
            Min Score:
            <select
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="ml-1 rounded bg-gray-800 px-2 py-1 text-sm text-white"
            >
              <option value={30}>30+</option>
              <option value={40}>40+</option>
              <option value={50}>50+</option>
              <option value={60}>60+</option>
              <option value={70}>70+</option>
            </select>
          </label>
          <button
            onClick={handleScan}
            disabled={isFetching}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:bg-blue-500 disabled:opacity-50"
          >
            {isFetching ? "Scanning..." : "🔍 Scan Market"}
          </button>
        </div>
      </div>

      {/* Strategy Selector */}
      <div className="mb-6 flex flex-wrap gap-2">
        {STRATEGIES.map((s) => (
          <button
            key={s.value}
            onClick={() => setSelected(s.value)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              selected === s.value
                ? "bg-blue-600 text-white shadow"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
            }`}
          >
            {s.icon} {s.label}
            {s.value !== "ALL" && (
              <span
                className={`ml-1 rounded px-1 py-0.5 text-[10px] font-bold ${
                  s.seller
                    ? "bg-orange-900/40 text-orange-400"
                    : "bg-gray-700/50 text-gray-500"
                }`}
              >
                {s.seller ? "SELL" : "BUY"}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Market Context Bar */}
      {snapshot && snapshot.spot > 0 && (
        <div className="mb-6 flex flex-wrap gap-4 rounded-lg border border-gray-800 bg-gray-900/60 p-3 text-sm">
          <Pill label="Spot" value={snapshot.spot.toLocaleString("en-IN")} />
          <Pill label="VIX" value={snapshot.vix.toFixed(1)} />
          <Pill label="Trend" value={trendLabel(snapshot.trend)} />
          <Pill label="PCR" value={snapshot.pcr.toFixed(2)} />
          <Pill label="IV%ile" value={`${snapshot.ivPercentile}%`} />
          {data?.scannedAt && (
            <span className="ml-auto text-xs text-gray-600">
              Scanned {new Date(data.scannedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-900 p-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <span className="text-gray-400">Scanning market conditions across all strategies…</span>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && suggestions.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-700 bg-gray-900/50 p-12 text-center">
          <p className="text-lg text-gray-500">
            {data
              ? "No suggestions met the confidence threshold. Try lowering the min score."
              : "Click \"Scan Market\" to find high-probability trade setups."}
          </p>
        </div>
      )}

      {/* Results Count */}
      {suggestions.length > 0 && (
        <p className="mb-4 text-sm text-gray-500">
          Found <span className="font-semibold text-white">{suggestions.length}</span>{" "}
          suggestion{suggestions.length !== 1 ? "s" : ""} sorted by confidence
        </p>
      )}

      {/* Suggestion Cards */}
      <div className="grid gap-4 lg:grid-cols-2">
        {suggestions.map((sug) => {
          const meta = STRATEGY_META[sug.strategy];
          const expanded = expandedId === sug.id;
          const dirBadge = DIRECTION_BADGE[sug.direction] ?? DIRECTION_BADGE.NEUTRAL;

          return (
            <div
              key={sug.id}
              className={`group rounded-xl border bg-gray-900 transition-all ${
                expanded ? "border-blue-700" : "border-gray-800 hover:border-gray-700"
              }`}
            >
              {/* Card Header */}
              <div className="flex items-center justify-between border-b border-gray-800 p-4">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{meta?.icon ?? "📈"}</span>
                  <div>
                    <span className="font-bold text-white">
                      {meta?.name ?? sug.strategy.replace(/_/g, " ")}
                    </span>
                    <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${dirBadge.bg} ${dirBadge.text}`}>
                      {sug.direction}
                    </span>
                    <span
                      className={`ml-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        SELLER_SET.has(sug.strategy)
                          ? "bg-orange-900/40 text-orange-400"
                          : "bg-gray-700/50 text-gray-500"
                      }`}
                    >
                      {SELLER_SET.has(sug.strategy) ? "SELLER" : "BUYER"}
                    </span>
                  </div>
                </div>
                <span
                  className={`rounded-full border px-3 py-1 text-sm font-bold ${
                    TIER_COLORS[sug.confidenceTier] ?? TIER_COLORS.LOW
                  }`}
                >
                  {sug.confidence}%
                </span>
              </div>

              {/* Legs */}
              <div className="border-b border-gray-800 px-4 py-3">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500">
                      <th className="pb-1 text-left font-normal">Leg</th>
                      <th className="pb-1 text-right font-normal">Strike</th>
                      <th className="pb-1 text-right font-normal">Premium</th>
                      <th className="pb-1 text-right font-normal">IV</th>
                      <th className="pb-1 text-right font-normal">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sug.legs.map((leg, j) => (
                      <tr key={j} className="border-t border-gray-800/50">
                        <td
                          className={`py-1 font-medium ${
                            leg.type.startsWith("BUY") ? "text-green-400" : "text-red-400"
                          }`}
                        >
                          {formatLeg(leg.type)}
                        </td>
                        <td className="py-1 text-right text-white">{leg.strike}</td>
                        <td className="py-1 text-right">₹{leg.premium.toFixed(1)}</td>
                        <td className="py-1 text-right text-gray-400">
                          {leg.iv > 0 ? `${leg.iv.toFixed(1)}%` : "—"}
                        </td>
                        <td className="py-1 text-right">{leg.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Key Metrics */}
              <div className="grid grid-cols-4 gap-2 border-b border-gray-800 px-4 py-3 text-center text-xs">
                <MetricCell
                  label="Net Premium"
                  value={`₹${Math.abs(sug.netPremium).toFixed(0)}`}
                  sub={sug.netPremium >= 0 ? "Credit" : "Debit"}
                  positive={sug.netPremium >= 0}
                />
                <MetricCell
                  label="Max Profit"
                  value={`₹${sug.maxProfit.toLocaleString("en-IN")}`}
                  positive
                />
                <MetricCell
                  label="Max Loss"
                  value={`₹${Math.abs(sug.maxLoss).toLocaleString("en-IN")}`}
                  positive={false}
                />
                <MetricCell
                  label="R:R"
                  value={`${sug.expectedRiskReward}x`}
                  positive={sug.expectedRiskReward >= 1}
                />
              </div>

              {/* Breakeven */}
              {sug.breakeven.length > 0 && (
                <div className="border-b border-gray-800 px-4 py-2 text-xs text-gray-400">
                  <span className="mr-1 font-medium text-gray-500">Breakeven:</span>
                  {sug.breakeven.map((b) => b.toFixed(0)).join(" / ")}
                </div>
              )}

              {/* Expand/Collapse Toggle */}
              <button
                onClick={() => setExpandedId(expanded ? null : sug.id)}
                className="w-full px-4 py-2 text-left text-xs text-blue-400 hover:text-blue-300"
              >
                {expanded ? "▲ Hide Details" : "▼ Show Rationale & Exit Rules"}
              </button>

              {/* Expanded Details */}
              {expanded && (
                <div className="border-t border-gray-800 px-4 pb-4 pt-3">
                  {/* Rationale */}
                  <div className="mb-3">
                    <h4 className="mb-1 text-xs font-semibold uppercase text-gray-500">
                      Rationale
                    </h4>
                    <ul className="space-y-0.5 text-xs text-gray-300">
                      {sug.rationale.map((r, i) => (
                        <li key={i} className="flex gap-1.5">
                          <span className="mt-0.5 text-blue-500">•</span>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Exit Rules */}
                  <div>
                    <h4 className="mb-1 text-xs font-semibold uppercase text-gray-500">
                      Exit Rules
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <ExitPill label="🛑 SL" text={sug.exitRules.stopLoss} />
                      <ExitPill label="🎯 Target" text={sug.exitRules.target} />
                      <ExitPill label="📈 Trail" text={sug.exitRules.trailingSL} />
                      <ExitPill label="⏰ Time" text={sug.exitRules.timeExit} />
                    </div>
                  </div>

                  {/* Market Context */}
                  <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
                    <span>ATM: {sug.marketContext.atm}</span>
                    <span>VIX: {sug.marketContext.vix.toFixed(1)}</span>
                    <span>PCR: {sug.marketContext.pcr.toFixed(2)}</span>
                    <span>IV%ile: {sug.marketContext.ivPercentile}%</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-gray-500">{label}: </span>
      <span className="font-semibold text-white">{value}</span>
    </div>
  );
}

function MetricCell({
  label,
  value,
  sub,
  positive,
}: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
}) {
  return (
    <div>
      <div className="text-gray-500">{label}</div>
      <div className={`font-semibold ${positive ? "text-green-400" : "text-red-400"}`}>
        {value}
      </div>
      {sub && <div className="text-gray-600">{sub}</div>}
    </div>
  );
}

function ExitPill({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded bg-gray-800/60 px-2 py-1">
      <span className="font-medium">{label}: </span>
      <span className="text-gray-400">{text}</span>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────

function formatLeg(type: string): string {
  return type.replace(/_/g, " ");
}

function trendLabel(trend: string): string {
  const map: Record<string, string> = {
    "trend-up": "📈 Bullish",
    "trend-down": "📉 Bearish",
    "range-bound": "↔️ Sideways",
  };
  return map[trend] ?? trend;
}
