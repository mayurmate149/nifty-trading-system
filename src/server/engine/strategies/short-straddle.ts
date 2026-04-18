/**
 * Short Straddle Strategy (SELL)
 *
 * Sell ATM Call + ATM Put — collect maximum premium.
 * Profit from theta decay when market stays range-bound.
 * Best in: High IV, sideways market, post-event IV crush.
 *
 * Risk: Unlimited — MUST use strict SL.
 */

import { MarketIndicators } from "@/types/market";

export const shortStraddleStrategy = {
  name: "SHORT_STRADDLE" as const,
  description: "Sell ATM call + put; profit from theta decay in sideways markets",
  legs: 2,

  idealConditions: {
    trend: "range-bound" as const,
    ivPercentileMin: 40,
    pcrRange: [0.75, 1.25] as [number, number],
    vixRange: [13, 25] as [number, number],
  },

  checkEntry(indicators: MarketIndicators): { suitable: boolean; reasons: string[] } {
    const reasons: string[] = [];
    let suitable = false;

    // HIGH IV is great for short straddle — more premium to collect
    if (indicators.ivPercentile >= 50) {
      suitable = true;
      reasons.push(`IV percentile ${indicators.ivPercentile}% — fat premiums for selling straddle`);
    } else if (indicators.ivPercentile >= 35) {
      suitable = true;
      reasons.push(`IV percentile ${indicators.ivPercentile}% — decent premium for straddle sell`);
    } else {
      reasons.push(`IV percentile ${indicators.ivPercentile}% — thin premiums, straddle may not be worth it`);
    }

    // Range-bound is ideal — if trending, risky
    if (indicators.trendStrength <= 35) {
      reasons.push(`Trend strength ${indicators.trendStrength} — low, sideways market favors short straddle`);
    } else if (indicators.trendStrength <= 50) {
      reasons.push(`Trend strength ${indicators.trendStrength} — mild trend, sell with tighter SL`);
    } else {
      reasons.push(`⚠️ Trend strength ${indicators.trendStrength} — strong trend, risky for short straddle`);
    }

    // PCR near 1 = balanced, good for non-directional sell
    if (indicators.pcr >= 0.75 && indicators.pcr <= 1.25) {
      reasons.push(`PCR ${indicators.pcr.toFixed(2)} balanced — no strong directional pull`);
    } else {
      reasons.push(`PCR ${indicators.pcr.toFixed(2)} skewed — one-sided risk for straddle`);
    }

    // VIX check
    if (indicators.vix >= 13 && indicators.vix <= 25) {
      reasons.push(`VIX ${indicators.vix.toFixed(1)} — healthy premium environment`);
    } else if (indicators.vix > 25) {
      reasons.push(`VIX ${indicators.vix.toFixed(1)} — very high, premiums juicy but risk of big move`);
    }

    return { suitable, reasons };
  },

  exitRules: {
    stopLoss: "SL at 1.5× to 2× total premium collected (combined position)",
    target: "TP at 50% of premium collected — don't be greedy",
    trailingSL: "After 30% profit, trail SL to cost",
    timeExit: "Close before last 2 hours of expiry day (gamma risk)",
  },
};
