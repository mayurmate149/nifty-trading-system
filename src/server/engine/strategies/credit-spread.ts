/**
 * Credit Spread Strategy
 *
 * Bull Put Spread: Sell OTM put + buy further OTM put (bullish).
 * Bear Call Spread: Sell OTM call + buy further OTM call (bearish).
 * Best in: Directional bias with moderate IV.
 */

import { MarketIndicators } from "@/types/market";

export const creditSpreadStrategy = {
  name: "CREDIT_SPREAD" as const,
  description: "Sell near-ATM spread for directional bias with limited risk",
  legs: 2,

  idealConditions: {
    trends: ["trend-up", "trend-down"] as const,
    pcrRange: [0.5, 1.5] as [number, number],
    ivPercentileMin: 30,
    ivPercentileMax: 80,
    vixRange: [12, 25] as [number, number],
  },

  checkEntry(indicators: MarketIndicators): { suitable: boolean; reasons: string[] } {
    const reasons: string[] = [];
    let suitable = true;

    if (indicators.trend === "range-bound") {
      reasons.push("Range-bound — credit spread works but pick wider strikes");
    } else {
      reasons.push(`${indicators.trend} — directional credit spread aligns`);
    }

    if (indicators.ivPercentile >= 30) {
      reasons.push(`IV percentile ${indicators.ivPercentile}% — decent premium for selling`);
    } else {
      reasons.push(`IV percentile ${indicators.ivPercentile}% — thin premiums`);
      suitable = indicators.trendStrength >= 60;
    }

    if (indicators.vix >= 12 && indicators.vix <= 25) {
      reasons.push(`VIX ${indicators.vix.toFixed(1)} in comfort zone`);
    }

    return { suitable, reasons };
  },

  exitRules: {
    stopLoss: "Exit at 2x credit received or underlying breaches sell strike",
    target: "Close at 50-60% of max profit",
    trailingSL: "Trail SL to breakeven after 40% profit",
    timeExit: "Close 1-2 days before expiry",
  },
};
