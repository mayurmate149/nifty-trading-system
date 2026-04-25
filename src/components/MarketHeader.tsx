"use client";

/**
 * MarketHeader Component
 *
 * Displays key market metrics in a horizontal strip:
 * Nifty spot + change, BankNifty, VIX, Trend, PCR, IV Percentile
 */

import { MarketIndicators } from "@/types/market";
import { useMarketTicks } from "@/contexts/MarketTicksContext";

interface MarketHeaderProps {
  indicators: MarketIndicators | null | undefined;
  bankNifty?: number;
}

export function MarketHeader({ indicators, bankNifty }: MarketHeaderProps) {
  const rt = useMarketTicks();
  const isLive = rt?.connection === "open";
  if (!indicators) {
    return (
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="animate-pulse rounded-lg border border-gray-800 bg-gray-900 p-4">
            <div className="mb-2 h-3 w-12 rounded bg-gray-800" />
            <div className="h-6 w-20 rounded bg-gray-800" />
          </div>
        ))}
      </div>
    );
  }

  const spot = indicators.spot;
  const changeColor = indicators.spotChangePct >= 0 ? "text-green-400" : "text-red-400";
  const changeArrow = indicators.spotChangePct >= 0 ? "▲" : "▼";

  const trendColors: Record<string, string> = {
    "trend-up": "text-green-400 bg-green-900/30",
    "trend-down": "text-red-400 bg-red-900/30",
    "range-bound": "text-yellow-400 bg-yellow-900/30",
  };
  const trendLabels: Record<string, string> = {
    "trend-up": "📈 Bullish",
    "trend-down": "📉 Bearish",
    "range-bound": "↔️ Range",
  };

  const vixColor = indicators.vix > 20 ? "text-red-400" : indicators.vix > 15 ? "text-yellow-400" : "text-green-400";

  const cards = [
    {
      label: "NIFTY 50",
      value: spot.toLocaleString("en-IN", { maximumFractionDigits: 2 }),
      sub: `${changeArrow} ${Math.abs(indicators.spotChange).toFixed(2)} (${Math.abs(indicators.spotChangePct).toFixed(2)}%)`,
      subColor: changeColor,
    },
    {
      label: "BANK NIFTY",
      value: (bankNifty ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 }),
      sub: null,
      subColor: "text-gray-400",
    },
    {
      label: "INDIA VIX",
      value: indicators.vix.toFixed(2),
      sub: `IV Pctl: ${indicators.ivPercentile}%`,
      subColor: vixColor,
      valueColor: vixColor,
    },
    {
      label: "TREND",
      value: trendLabels[indicators.trend] ?? "—",
      sub: `Strength: ${indicators.trendStrength}%`,
      subColor: "text-gray-400",
      badge: trendColors[indicators.trend] ?? "",
    },
    {
      label: "PIVOT",
      value: indicators.pivotPoint.toLocaleString("en-IN", { maximumFractionDigits: 2 }),
      sub: `DTE: ${indicators.daysToExpiry.toFixed(1)}d`,
      subColor: "text-gray-400",
    },
    {
      label: "S/R LEVELS",
      value: `S: ${indicators.support[0]?.toFixed(0) ?? "—"}`,
      sub: `R: ${indicators.resistance[0]?.toFixed(0) ?? "—"}`,
      subColor: "text-red-400",
      valueColor: "text-green-400",
    },
  ];

  return (
    <>
    <div className="mb-3 flex items-center justify-end gap-2 text-xs text-gray-500">
      {isLive && (
        <span className="inline-flex items-center gap-1 rounded border border-emerald-800/80 bg-emerald-950/40 px-2 py-0.5 font-medium text-emerald-400">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          Realtime (WS)
        </span>
      )}
    </div>
    <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((card, i) => (
        <div
          key={i}
          className={`rounded-lg border border-gray-800 bg-gray-900 p-3 transition hover:border-gray-700 ${card.badge ?? ""}`}
        >
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-gray-500">
            {card.label}
          </div>
          <div className={`text-lg font-bold ${card.valueColor ?? "text-gray-100"}`}>
            {card.value}
          </div>
          {card.sub && (
            <div className={`mt-0.5 text-xs ${card.subColor}`}>{card.sub}</div>
          )}
        </div>
      ))}
    </div>
    </>
  );
}
