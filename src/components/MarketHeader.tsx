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
      <div className="mb-6 rounded-xl border border-white/[0.08] bg-black/20 p-3 sm:p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] pb-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-vz-muted">Market</span>
          <span className="inline-block h-7 w-28 animate-pulse rounded-lg bg-white/[0.06]" aria-hidden />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-lg border border-white/[0.06] bg-white/[0.03] p-4">
              <div className="mb-2 h-3 w-12 rounded bg-white/[0.08]" />
              <div className="h-6 w-20 rounded bg-white/[0.08]" />
            </div>
          ))}
        </div>
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
    <section className="mb-6 rounded-xl border border-white/[0.08] bg-vz-card/35 p-3 shadow-sm sm:p-4" aria-label="Market snapshot">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] pb-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-vz-muted">Market</span>
        {isLive ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" aria-hidden />
            Realtime (WS)
          </span>
        ) : (
          <span className="text-[11px] text-vz-muted">Polling / REST</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((card, i) => (
          <div
            key={i}
            className={`rounded-lg border border-white/[0.06] bg-black/25 p-3 transition hover:border-white/[0.1] ${card.badge ?? ""}`}
          >
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-vz-muted">
              {card.label}
            </div>
            <div className={`text-lg font-bold ${card.valueColor ?? "text-gray-100"}`}>{card.value}</div>
            {card.sub && <div className={`mt-0.5 text-xs ${card.subColor}`}>{card.sub}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}
