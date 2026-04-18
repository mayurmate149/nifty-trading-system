/**
 * Short Strangle Strategy (SELL)
 *
 * Sell OTM Call + OTM Put — wider profit zone than straddle.
 * Lower premium collected but safer range.
 * Best in: High IV, range-bound, strong OI walls on both sides.
 *
 * Risk: Unlimited — MUST use strict SL.
 */

import { MarketIndicators } from "@/types/market";

export const shortStrangleStrategy = {
  name: "SHORT_STRANGLE" as const,
  description: "Sell OTM call + put; wider profit zone, theta decay",
  legs: 2,

  idealConditions: {
    trend: "range-bound" as const,
    ivPercentileMin: 35,
    pcrRange: [0.7, 1.3] as [number, number],
    vixRange: [13, 25] as [number, number],
  },

  checkEntry(indicators: MarketIndicators): { suitable: boolean; reasons: string[] } {
    const reasons: string[] = [];
    let suitable = false;

    // High IV = more premium at OTM strikes
    if (indicators.ivPercentile >= 40) {
      suitable = true;
      reasons.push(`IV percentile ${indicators.ivPercentile}% — good OTM premiums for selling`);
    } else if (indicators.ivPercentile >= 25) {
      suitable = true;
      reasons.push(`IV percentile ${indicators.ivPercentile}% — moderate premiums, sell closer strikes`);
    } else {
      reasons.push(`IV percentile ${indicators.ivPercentile}% — OTM premiums too thin for strangle`);
    }

    // Range-bound ideal
    if (indicators.trendStrength <= 40) {
      reasons.push(`Trend strength ${indicators.trendStrength} — range-bound, strangle sweet spot`);
    } else if (indicators.trendStrength <= 55) {
      reasons.push(`Trend strength ${indicators.trendStrength} — mild directional, keep wider strikes`);
    } else {
      reasons.push(`⚠️ Trend strength ${indicators.trendStrength} — strong trend, strangle risky`);
    }

    // PCR near neutral
    if (indicators.pcr >= 0.7 && indicators.pcr <= 1.3) {
      reasons.push(`PCR ${indicators.pcr.toFixed(2)} — balanced, supports strangle`);
    }

    // DTE check — need some time for theta to work
    if (indicators.daysToExpiry >= 2 && indicators.daysToExpiry <= 7) {
      reasons.push(`${indicators.daysToExpiry} DTE — ideal for weekly strangle sell`);
    } else if (indicators.daysToExpiry < 2) {
      reasons.push(`${indicators.daysToExpiry} DTE — expiry day, gamma risk high`);
    }

    return { suitable, reasons };
  },

  exitRules: {
    stopLoss: "SL at 2× premium on either leg (individual leg SL)",
    target: "TP when 50-60% of premium decays",
    trailingSL: "After 40% profit, trail SL to breakeven",
    timeExit: "Close on expiry morning or previous day EOD",
  },
};
