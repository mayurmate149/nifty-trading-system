/**
 * Scalp Sell Strategy (SELL)
 *
 * Quick intraday OTM option sell for fast theta/premium capture.
 * Sell OTM option on the contra side of the trend.
 *   - Bullish market → sell OTM Put (below support)
 *   - Bearish market → sell OTM Call (above resistance)
 *   - Sideways → sell both sides
 *
 * Hold time: 15-60 minutes. Tight SL mandatory.
 *
 * Risk: Unlimited — MUST use strict SL.
 */

import { MarketIndicators } from "@/types/market";

export const scalpSellStrategy = {
  name: "SCALP_SELL" as const,
  description: "Quick OTM option sell on contra side for fast premium capture",
  legs: 1,

  idealConditions: {
    trend: "any" as const,
    trendStrengthMin: 30,
    ivPercentileMin: 20,
    vixRange: [10, 30] as [number, number],
  },

  checkEntry(indicators: MarketIndicators): { suitable: boolean; reasons: string[] } {
    const reasons: string[] = [];
    let suitable = false;

    // Need some IV for premium to be worth selling
    if (indicators.ivPercentile >= 30) {
      suitable = true;
      reasons.push(`IV percentile ${indicators.ivPercentile}% — OTM premiums worth selling`);
    } else if (indicators.ivPercentile >= 15) {
      suitable = true;
      reasons.push(`IV percentile ${indicators.ivPercentile}% — moderate, sell close strikes`);
    } else {
      reasons.push(`IV percentile ${indicators.ivPercentile}% — premiums too thin for scalp sell`);
    }

    // Trend direction helps pick which side to sell
    if (indicators.trend === "trend-up") {
      reasons.push(`Bullish trend → sell OTM Puts (they decay fastest)`);
    } else if (indicators.trend === "trend-down") {
      reasons.push(`Bearish trend → sell OTM Calls (they decay fastest)`);
    } else {
      reasons.push(`Range-bound → sell both sides OTM for theta capture`);
    }

    // VIX range
    if (indicators.vix >= 10 && indicators.vix <= 25) {
      reasons.push(`VIX ${indicators.vix.toFixed(1)} — manageable for intraday sell`);
    } else if (indicators.vix > 25) {
      reasons.push(`VIX ${indicators.vix.toFixed(1)} — high, sell further OTM with tight SL`);
    }

    // Spot near S/R helps as natural barrier
    const nearest = findNearestSR(indicators);
    if (nearest && nearest.distance <= 80) {
      reasons.push(
        `Spot within ${nearest.distance}pts of ${nearest.type} ${nearest.level} — S/R acts as barrier for sell`
      );
    }

    // Expiry day boost — theta accelerates
    if (indicators.daysToExpiry <= 1) {
      reasons.push("Expiry day — theta decay fastest, perfect for scalp sell");
    }

    return { suitable, reasons };
  },

  exitRules: {
    stopLoss: "SL at 2× premium collected or 40pt adverse Nifty move",
    target: "TP at 50% of premium decay (or 20-30pt move in your favor)",
    trailingSL: "After 30% profit, trail SL to cost",
    timeExit: "Close within 30-60 minutes or at 3:15 PM, whichever first",
  },
};

/* ---------- helpers ---------- */

function findNearestSR(
  ind: MarketIndicators
): { level: number; distance: number; type: string } | null {
  const levels = [
    ...(ind.support || []).map((l) => ({ level: l, type: "support" })),
    ...(ind.resistance || []).map((l) => ({ level: l, type: "resistance" })),
    ...(ind.pivotPoint ? [{ level: ind.pivotPoint, type: "pivot" }] : []),
  ];
  if (!levels.length) return null;

  let best = levels[0];
  let bestDist = Math.abs(ind.spot - best.level);
  for (const l of levels) {
    const d = Math.abs(ind.spot - l.level);
    if (d < bestDist) {
      best = l;
      bestDist = d;
    }
  }
  return { level: best.level, distance: Math.round(bestDist), type: best.type };
}
