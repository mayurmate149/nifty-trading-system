/**
 * Iron Condor Strategy
 *
 * Entry: Sell OTM Call + Sell OTM Put, Buy further OTM Call + Put for protection.
 * Best in: Range-bound market, neutral PCR, moderate-high IV.
 * Exit: SL at 2x credit, trail at breakeven after 50% profit, TP at 60-70% of max.
 */

import { MarketIndicators } from "@/types/market";

export const ironCondorStrategy = {
  name: "IRON_CONDOR" as const,
  description: "Sell OTM call + put spreads for range-bound markets",
  legs: 4,

  idealConditions: {
    trend: "range-bound" as const,
    pcrRange: [0.7, 1.3] as [number, number],
    ivPercentileMin: 30,
    ivPercentileMax: 80,
    vixRange: [12, 22] as [number, number],
  },

  /** Check if market conditions are suitable */
  checkEntry(indicators: MarketIndicators): { suitable: boolean; reasons: string[] } {
    const reasons: string[] = [];
    let suitable = true;

    if (indicators.trend !== "range-bound") {
      suitable = false;
      reasons.push(`Market is ${indicators.trend}, IC prefers range-bound`);
    } else {
      reasons.push("Range-bound market — ideal for Iron Condor");
    }

    if (indicators.pcr < 0.7 || indicators.pcr > 1.3) {
      reasons.push(`PCR ${indicators.pcr.toFixed(2)} is skewed — higher directional risk`);
    } else {
      reasons.push(`PCR ${indicators.pcr.toFixed(2)} is neutral — balanced OI`);
    }

    if (indicators.vix > 22) {
      reasons.push(`VIX ${indicators.vix.toFixed(1)} is high — wider wings needed`);
    } else if (indicators.vix < 12) {
      reasons.push(`VIX ${indicators.vix.toFixed(1)} is low — thin premiums`);
      suitable = false;
    }

    if (indicators.ivPercentile >= 30) {
      reasons.push(`IV percentile ${indicators.ivPercentile}% — good premium for selling`);
    }

    return { suitable, reasons };
  },

  exitRules: {
    stopLoss: "Exit if any leg hits 2x credit received",
    target: "Close at 60-70% of max profit",
    trailingSL: "Move SL to breakeven after 50% profit",
    timeExit: "Close 2 days before expiry to avoid gamma risk",
  },
};
