/**
 * Directional Buy Strategy
 *
 * Buy ATM/slight OTM call (bullish) or put (bearish).
 * Best in: Strong trend, low IV, clear momentum.
 */

import { MarketIndicators } from "@/types/market";

export const directionalBuyStrategy = {
  name: "DIRECTIONAL_BUY" as const,
  description: "Buy ATM/slightly OTM option in trending market",
  legs: 1,

  idealConditions: {
    trends: ["trend-up", "trend-down"] as const,
    ivPercentileMax: 40,
    pcrRange: [0.4, 1.6] as [number, number],
    vixRange: [8, 18] as [number, number],
  },

  checkEntry(indicators: MarketIndicators): { suitable: boolean; reasons: string[] } {
    const reasons: string[] = [];
    let suitable = false;

    if (indicators.trend === "trend-up" && indicators.trendStrength >= 50) {
      suitable = true;
      reasons.push(`Strong uptrend (${indicators.trendStrength}%) — buy CE`);
    } else if (indicators.trend === "trend-down" && indicators.trendStrength >= 50) {
      suitable = true;
      reasons.push(`Strong downtrend (${indicators.trendStrength}%) — buy PE`);
    } else if (indicators.trend !== "range-bound") {
      reasons.push(`Weak ${indicators.trend} — wait for confirmation`);
    } else {
      reasons.push("Range-bound — directional buy risky, skip");
    }

    if (indicators.ivPercentile <= 30) {
      reasons.push(`Low IV (${indicators.ivPercentile}%) — cheap options, good for buying`);
    } else if (indicators.ivPercentile <= 50) {
      reasons.push(`Moderate IV (${indicators.ivPercentile}%) — acceptable`);
    } else {
      reasons.push(`High IV (${indicators.ivPercentile}%) — expensive, risk of IV crush`);
      suitable = false;
    }

    return { suitable, reasons };
  },

  exitRules: {
    stopLoss: "SL at 30% of premium paid",
    target: "TP at 50-100% premium gain (or trail)",
    trailingSL: "After 30% gain, trail SL to cost",
    timeExit: "Close before 2 days to expiry (theta burn)",
  },
};
