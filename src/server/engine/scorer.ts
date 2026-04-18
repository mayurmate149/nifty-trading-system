/**
 * Trade Suggestion Scorer — Options SELLER Focused
 *
 * Scores strategy suggestions 0–100 based on market conditions.
 * Biased towards premium-selling strategies:
 *   - High IV = good (more premium to collect)
 *   - Range-bound = good (theta works for you)
 *   - High OI at sell strikes = strong wall (resistance to breakout)
 *   - Seller strategies get a built-in bonus
 *
 * Scoring weights (total = 100):
 *   OI Buildup / liquidity    → 20 pts
 *   PCR alignment             → 15 pts
 *   IV Percentile (seller)    → 15 pts
 *   Trend alignment           → 20 pts
 *   S/R proximity             → 15 pts
 *   Volume confirmation       → 15 pts
 *
 * + Seller Bonus: +8 pts for SELLER bias, -10 pts for BUYER bias
 */

import { StrategyType, STRATEGY_META, ConfidenceTier } from "@/types/strategy";
import { MarketIndicators, OptionChainStrike } from "@/types/market";

export interface ScoringInput {
  strategy: StrategyType;
  chain: OptionChainStrike[];
  indicators: MarketIndicators;
  sellStrikes?: number[];  // for credit/IC strategies
  buyStrikes?: number[];   // for debit strategies
  spot: number;
}

export interface ScoringResult {
  score: number;
  tier: ConfidenceTier;
  breakdown: {
    oiBuildUp: number;
    pcrAlignment: number;
    ivAlignment: number;
    trendAlignment: number;
    srProximity: number;
    volumeConfirmation: number;
  };
  reasons: string[];
}

// ─── Main Scoring Function ──────────────────

export function scoreStrategy(input: ScoringInput): ScoringResult {
  const { strategy, chain, indicators, sellStrikes, buyStrikes, spot } = input;
  const meta = STRATEGY_META[strategy];
  const reasons: string[] = [];

  // 1. OI Buildup (20 pts)
  const oiBuildUp = scoreOI(chain, sellStrikes ?? buyStrikes ?? [], strategy, reasons);

  // 2. PCR Alignment (15 pts)
  const pcrAlignment = scorePCR(indicators.pcr, meta, strategy, reasons);

  // 3. IV Percentile — SELLER gets bonus for high IV (15 pts)
  const ivAlignment = scoreIV(indicators.ivPercentile, indicators.vix, meta, strategy, reasons);

  // 4. Trend Alignment (20 pts)
  const trendAlignment = scoreTrend(indicators.trend, indicators.trendStrength, meta, strategy, reasons);

  // 5. S/R Proximity — sell strikes beyond S/R (15 pts)
  const srProximity = scoreSR(spot, indicators.support, indicators.resistance, sellStrikes ?? [], strategy, reasons);

  // 6. Volume (15 pts)
  const volumeConfirmation = scoreVolume(chain, sellStrikes ?? buyStrikes ?? [], reasons);

  let rawScore = oiBuildUp + pcrAlignment + ivAlignment + trendAlignment + srProximity + volumeConfirmation;

  // ─── SELLER BIAS BONUS ────────────────────
  if (isSellStrategy(strategy)) {
    rawScore += 8;
    reasons.push("🏷️ Seller strategy — premium collection edge (+8)");
  } else {
    rawScore -= 10;
    reasons.push("⚠️ Buyer strategy — penalized for theta burn (-10)");
  }

  // Theta bonus: more DTE = more theta income for sellers
  if (isSellStrategy(strategy) && indicators.daysToExpiry >= 2 && indicators.daysToExpiry <= 7) {
    rawScore += 3;
    reasons.push(`${indicators.daysToExpiry} DTE — sweet spot for weekly theta selling (+3)`);
  }

  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  return {
    score,
    tier: score >= 75 ? "HIGH" : score >= 55 ? "MEDIUM" : "LOW",
    breakdown: { oiBuildUp, pcrAlignment, ivAlignment, trendAlignment, srProximity, volumeConfirmation },
    reasons,
  };
}

// ─── Individual Scoring Functions ───────────

function scoreOI(
  chain: OptionChainStrike[],
  targetStrikes: number[],
  strategy: StrategyType,
  reasons: string[],
): number {
  if (chain.length === 0) return 5;

  // For sell strategies: high OI at sell strikes = good (resistance to breakout)
  // For buy strategies: high OI = liquidity
  const maxOI = Math.max(...chain.map((s) => Math.max(s.ce.oi, s.pe.oi)), 1);

  if (targetStrikes.length === 0) {
    // No specific strikes — check overall OI distribution
    const avgOI = chain.reduce((sum, s) => sum + s.ce.oi + s.pe.oi, 0) / (chain.length * 2);
    if (avgOI > 0) {
      reasons.push("Options chain has active OI");
      return 12;
    }
    return 5;
  }

  let oiScore = 0;
  for (const strike of targetStrikes) {
    const row = chain.find((s) => s.strike === strike);
    if (!row) continue;

    const ceOI = row.ce.oi;
    const peOI = row.pe.oi;
    const bestOI = Math.max(ceOI, peOI);
    const oiRatio = bestOI / maxOI;

    if (oiRatio > 0.7) {
      oiScore += 10;
      reasons.push(`Strike ${strike} has very high OI (${formatLakh(bestOI)})`);
    } else if (oiRatio > 0.4) {
      oiScore += 6;
      reasons.push(`Strike ${strike} has good OI (${formatLakh(bestOI)})`);
    } else if (oiRatio > 0.15) {
      oiScore += 3;
    }

    // Check ΔOI for buildup
    const ceChange = row.ce.changeInOi;
    const peChange = row.pe.changeInOi;
    if (isSellStrategy(strategy)) {
      if (ceChange > 0 || peChange > 0) {
        oiScore += 3;
        reasons.push(`OI buildup at ${strike} confirms strong writing`);
      }
    } else {
      if (Math.abs(ceChange) + Math.abs(peChange) > 0) {
        oiScore += 2;
      }
    }
  }

  return Math.min(20, oiScore);
}

function scorePCR(
  pcr: number,
  meta: (typeof STRATEGY_META)[StrategyType],
  strategy: StrategyType,
  reasons: string[],
): number {
  const [lo, hi] = meta.idealConditions.pcrRange;

  if (pcr >= lo && pcr <= hi) {
    reasons.push(`PCR ${pcr.toFixed(2)} is in ideal range (${lo}–${hi})`);
    return 15;
  }

  // Partial score based on distance
  const dist = pcr < lo ? lo - pcr : pcr - hi;
  const score = Math.max(0, 15 - dist * 25);

  if (strategy === "IRON_CONDOR" || strategy === "SHORT_STRANGLE" || strategy === "SHORT_STRADDLE") {
    if (pcr >= 0.85 && pcr <= 1.15) {
      reasons.push(`PCR ${pcr.toFixed(2)} near neutral — good for non-directional selling`);
      return Math.max(score, 12);
    }
  }

  if (pcr < 0.6) reasons.push(`PCR ${pcr.toFixed(2)} very low — bearish sentiment`);
  else if (pcr > 1.4) reasons.push(`PCR ${pcr.toFixed(2)} very high — bullish/oversold`);

  return Math.round(score);
}

function scoreIV(
  ivPercentile: number,
  vix: number,
  meta: (typeof STRATEGY_META)[StrategyType],
  strategy: StrategyType,
  reasons: string[],
): number {
  const [lo, hi] = meta.idealConditions.ivPercentileRange;

  // Premium-selling strategies benefit from HIGH IV
  if (isSellStrategy(strategy)) {
    if (ivPercentile >= 40) {
      reasons.push(`IV percentile ${ivPercentile}% — rich premiums for selling`);
      return 15;
    }
    if (ivPercentile >= 25) {
      reasons.push(`IV percentile ${ivPercentile}% — moderate premiums`);
      return 10;
    }
    reasons.push(`IV percentile ${ivPercentile}% — premiums may be thin`);
    return 5;
  }

  // Premium-buying strategies benefit from LOW IV
  if (ivPercentile <= 30) {
    reasons.push(`IV percentile ${ivPercentile}% — cheap premiums for buying`);
    return 15;
  }
  if (ivPercentile <= 50) {
    reasons.push(`IV percentile ${ivPercentile}% — fair premiums`);
    return 10;
  }
  reasons.push(`IV percentile ${ivPercentile}% — expensive premiums, risk of IV crush`);
  return 4;
}

function scoreTrend(
  trend: string,
  trendStrength: number,
  meta: (typeof STRATEGY_META)[StrategyType],
  strategy: StrategyType,
  reasons: string[],
): number {
  const idealTrends = meta.idealConditions.trends;

  if (idealTrends.includes(trend)) {
    const strengthBonus = Math.round(trendStrength / 20); // 0-5 bonus
    const base = 15 + strengthBonus;
    reasons.push(`Market trend "${trend}" (strength ${trendStrength}%) aligns with ${strategy.replace(/_/g, " ")}`);
    return Math.min(20, base);
  }

  // Scalp sell can work in any trend — sell contra direction
  if (strategy === "SCALP_SELL" && (trend === "trend-up" || trend === "trend-down")) {
    if (trendStrength >= 50) {
      reasons.push(`Strong ${trend} — sell OTM on contra side for quick scalp`);
      return 16;
    }
    reasons.push(`Mild ${trend} — sell scalp with tight SL`);
    return 12;
  }

  // Non-directional sellers in trending market = penalty
  if ((strategy === "IRON_CONDOR" || strategy === "SHORT_STRADDLE" || strategy === "SHORT_STRANGLE") && trend !== "range-bound") {
    if (trendStrength >= 60) {
      reasons.push(`⚠️ Strong ${trend} — risky for non-directional sell`);
      return 3;
    }
    reasons.push(`Mild ${trend} — non-directional sell may still work`);
    return 8;
  }

  // Directional in wrong trend
  reasons.push(`Trend "${trend}" doesn't favor this strategy`);
  return 5;
}

function scoreSR(
  spot: number,
  support: number[],
  resistance: number[],
  sellStrikes: number[],
  strategy: StrategyType,
  reasons: string[],
): number {
  if (support.length === 0 && resistance.length === 0) return 7;

  let score = 0;

  // For sell strategies: strikes beyond S/R = safer
  if (isSellStrategy(strategy) && sellStrikes.length > 0) {
    for (const strike of sellStrikes) {
      // Check if sell call is above resistance
      if (strike > spot) {
        const nearestR = resistance.find((r) => r > spot) ?? 0;
        if (nearestR > 0 && strike >= nearestR) {
          score += 7;
          reasons.push(`Sell call ${strike} is at/above resistance ${nearestR}`);
        }
      }
      // Check if sell put is below support
      if (strike < spot) {
        const nearestS = support.find((s) => s < spot) ?? 0;
        if (nearestS > 0 && strike <= nearestS) {
          score += 7;
          reasons.push(`Sell put ${strike} is at/below support ${nearestS}`);
        }
      }
    }
    return Math.min(15, Math.max(score, 5));
  }

  // For buy strategies: spot near S/R for bounce/breakout
  const nearestSup = support.length > 0 ? Math.max(...support.filter((s) => s < spot)) : 0;
  const nearestRes = resistance.length > 0 ? Math.min(...resistance.filter((r) => r > spot)) : 0;

  if (nearestSup > 0) {
    const distPct = ((spot - nearestSup) / spot) * 100;
    if (distPct < 0.5) {
      score += 8;
      reasons.push(`Spot near support ${nearestSup} — potential bounce`);
    }
  }

  if (nearestRes > 0) {
    const distPct = ((nearestRes - spot) / spot) * 100;
    if (distPct < 0.5) {
      score += 8;
      reasons.push(`Spot near resistance ${nearestRes} — potential breakout or rejection`);
    }
  }

  return Math.min(15, Math.max(score, 5));
}

function scoreVolume(
  chain: OptionChainStrike[],
  targetStrikes: number[],
  reasons: string[],
): number {
  if (chain.length === 0) return 5;

  const maxVol = Math.max(...chain.map((s) => Math.max(s.ce.volume, s.pe.volume)), 1);

  if (targetStrikes.length === 0) {
    const totalVol = chain.reduce((sum, s) => sum + s.ce.volume + s.pe.volume, 0);
    if (totalVol > 0) {
      reasons.push("Active volume across chain");
      return 10;
    }
    return 5;
  }

  let volScore = 0;
  for (const strike of targetStrikes) {
    const row = chain.find((s) => s.strike === strike);
    if (!row) continue;
    const bestVol = Math.max(row.ce.volume, row.pe.volume);
    const ratio = bestVol / maxVol;

    if (ratio > 0.5) {
      volScore += 8;
      reasons.push(`High volume at strike ${strike}`);
    } else if (ratio > 0.2) {
      volScore += 5;
    } else {
      volScore += 2;
    }
  }

  return Math.min(15, volScore);
}

// ─── Helpers ────────────────────────────────

function isSellStrategy(strategy: StrategyType): boolean {
  return (
    strategy === "IRON_CONDOR" ||
    strategy === "CREDIT_SPREAD" ||
    strategy === "SHORT_STRADDLE" ||
    strategy === "SHORT_STRANGLE" ||
    strategy === "SCALP_SELL"
  );
}

function formatLakh(n: number): string {
  if (n >= 10000000) return `${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return `${n}`;
}
