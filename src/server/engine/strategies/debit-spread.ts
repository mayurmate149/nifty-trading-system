/**
 * Debit Spread Strategy
 *
 * Bull Call Spread  —  buy ATM call, sell OTM call  (bullish)
 * Bear Put Spread   —  buy ATM put,  sell OTM put   (bearish)
 *
 * Capped risk & reward, cheaper than naked buy, benefits from moderate move.
 */

import { MarketIndicators } from "@/types/market";

export const debitSpreadStrategy = {
  name: "DEBIT_SPREAD" as const,
  description: "Buy ATM + sell OTM of same type for capped-risk directional bet",
  legs: 2,

  idealConditions: {
    trend: "moderate-directional" as const,
    trendStrengthMin: 40,
    ivPercentileRange: [20, 55] as [number, number],
  },

  checkEntry(indicators: MarketIndicators): { suitable: boolean; reasons: string[] } {
    const reasons: string[] = [];
    let suitable = false;

    // Need moderate directional conviction
    if (indicators.trendStrength >= 40) {
      suitable = true;
      const dir = indicators.trend === "trend-up" ? "Bullish" : "Bearish";
      reasons.push(
        `${dir} trend strength ${indicators.trendStrength} — good for debit spread`
      );
    } else {
      reasons.push(
        `Trend strength ${indicators.trendStrength} — weak; debit spread may decay`
      );
    }

    // IV moderate — too low = cheap options (good), too high = expensive
    if (indicators.ivPercentile <= 55) {
      reasons.push(`IV percentile ${indicators.ivPercentile}% — acceptable for debit spread`);
    } else {
      reasons.push(
        `IV percentile ${indicators.ivPercentile}% — high; credit spread may be better`
      );
    }

    // DTE check
    if (indicators.daysToExpiry >= 3) {
      reasons.push(`${indicators.daysToExpiry} DTE — enough room for move`);
    } else {
      reasons.push(`${indicators.daysToExpiry} DTE — tight, needs quick move`);
    }

    return { suitable, reasons };
  },

  exitRules: {
    stopLoss: "SL at 50% of net debit paid",
    target: "TP at 60-80% of max profit (spread width minus debit)",
    trailingSL: "After 40% gain, trail SL to cost + 20%",
    timeExit: "Close 1 day before expiry to avoid pin risk",
  },
};
