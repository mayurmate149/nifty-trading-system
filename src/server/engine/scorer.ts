/**
 * Chain-Specific Confidence Scorer
 *
 * The rule engine already grades market regime + technicals + chain
 * structural rules. This scorer adds a complementary numeric score focused
 * purely on the *chosen strikes*:
 *   - OI concentration at the picked strikes (walls)
 *   - ΔOI build-up confirming fresh positioning
 *   - Volume at the picked strikes
 *   - Support / resistance proximity to the sell strikes
 *   - A small bias bonus for CREDIT (seller) structures
 *
 * Output 0–100 is blended with the rule-engine match % in `suggest.ts` to
 * produce the final `TradeSuggestion.confidence`.
 */

import { StrategyType, STRATEGY_META, ConfidenceTier } from "@/types/strategy";
import { MarketIndicators, OptionChainStrike } from "@/types/market";

export interface ScoringInput {
  strategy: StrategyType;
  chain: OptionChainStrike[];
  indicators: MarketIndicators;
  sellStrikes?: number[];
  buyStrikes?: number[];
  spot: number;
}

export interface ScoringResult {
  score: number;
  tier: ConfidenceTier;
  breakdown: {
    oiBuildUp: number;
    srProximity: number;
    volumeConfirmation: number;
    biasBonus: number;
  };
  reasons: string[];
}

export function scoreStrategy(input: ScoringInput): ScoringResult {
  const { strategy, chain, indicators, sellStrikes, buyStrikes, spot } = input;
  const meta = STRATEGY_META[strategy];
  const reasons: string[] = [];

  // 40 pts: OI concentration + build-up at picked strikes
  const oiBuildUp = scoreOI(chain, sellStrikes ?? buyStrikes ?? [], strategy, reasons);

  // 25 pts: S/R proximity — sell strikes outside S/R = safer
  const srProximity = scoreSR(
    spot,
    indicators.support,
    indicators.resistance,
    sellStrikes ?? [],
    strategy,
    reasons,
  );

  // 25 pts: Volume at picked strikes
  const volumeConfirmation = scoreVolume(chain, sellStrikes ?? buyStrikes ?? [], reasons);

  // 10 pts: CREDIT bonus (premium-collection structural edge)
  let biasBonus = 0;
  if (meta.bias === "CREDIT") {
    biasBonus = 8;
    reasons.push("Credit structure — premium collection edge (+8)");
  } else {
    biasBonus = -4;
    reasons.push("Debit structure — needs a real move to pay (-4)");
  }

  // Theta-window bonus for credit structures inside sweet DTE
  if (
    meta.bias === "CREDIT" &&
    indicators.daysToExpiry >= 2 &&
    indicators.daysToExpiry <= 7
  ) {
    biasBonus += 3;
    reasons.push(
      `${indicators.daysToExpiry} DTE — weekly theta sweet spot (+3)`,
    );
  }

  const raw = oiBuildUp + srProximity + volumeConfirmation + biasBonus;
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const tier: ConfidenceTier = score >= 75 ? "HIGH" : score >= 55 ? "MEDIUM" : "LOW";

  return {
    score,
    tier,
    breakdown: { oiBuildUp, srProximity, volumeConfirmation, biasBonus },
    reasons,
  };
}

// ─── OI (40 pts) ────────────────────────────────────────────────────────────

function scoreOI(
  chain: OptionChainStrike[],
  targetStrikes: number[],
  strategy: StrategyType,
  reasons: string[],
): number {
  if (chain.length === 0) return 8;

  const maxOI = Math.max(...chain.map((s) => Math.max(s.ce.oi, s.pe.oi)), 1);

  if (targetStrikes.length === 0) {
    const avgOI =
      chain.reduce((sum, s) => sum + s.ce.oi + s.pe.oi, 0) / (chain.length * 2);
    if (avgOI > 0) {
      reasons.push("Active OI across chain");
      return 20;
    }
    return 8;
  }

  const isCredit = STRATEGY_META[strategy].bias === "CREDIT";
  let oiScore = 0;
  for (const strike of targetStrikes) {
    const row = chain.find((s) => s.strike === strike);
    if (!row) continue;

    const bestOI = Math.max(row.ce.oi, row.pe.oi);
    const ratio = bestOI / maxOI;
    if (ratio > 0.7) {
      oiScore += 15;
      reasons.push(`${strike}: very high OI (${formatLakh(bestOI)})`);
    } else if (ratio > 0.4) {
      oiScore += 10;
      reasons.push(`${strike}: good OI (${formatLakh(bestOI)})`);
    } else if (ratio > 0.15) {
      oiScore += 5;
    }

    const ceChange = row.ce.changeInOi;
    const peChange = row.pe.changeInOi;
    if (isCredit) {
      if (ceChange > 0 || peChange > 0) {
        oiScore += 5;
        reasons.push(`${strike}: OI build-up confirms writing`);
      }
    } else if (Math.abs(ceChange) + Math.abs(peChange) > 0) {
      oiScore += 3;
    }
  }

  return Math.min(40, oiScore);
}

// ─── S/R (25 pts) ───────────────────────────────────────────────────────────

function scoreSR(
  spot: number,
  support: number[],
  resistance: number[],
  sellStrikes: number[],
  strategy: StrategyType,
  reasons: string[],
): number {
  if (support.length === 0 && resistance.length === 0) return 10;
  const isCredit = STRATEGY_META[strategy].bias === "CREDIT";

  if (isCredit && sellStrikes.length > 0) {
    let score = 0;
    for (const strike of sellStrikes) {
      if (strike > spot) {
        const nearestR = resistance.find((r) => r > spot) ?? 0;
        if (nearestR > 0 && strike >= nearestR) {
          score += 10;
          reasons.push(`Sell CE ${strike} ≥ resistance ${nearestR}`);
        }
      }
      if (strike < spot) {
        const nearestS = support.find((s) => s < spot) ?? 0;
        if (nearestS > 0 && strike <= nearestS) {
          score += 10;
          reasons.push(`Sell PE ${strike} ≤ support ${nearestS}`);
        }
      }
    }
    return Math.min(25, Math.max(score, 8));
  }

  // Debit: spot near S/R for bounce/breakout
  let score = 0;
  const nearestSup = support.length > 0 ? Math.max(...support.filter((s) => s < spot)) : 0;
  const nearestRes = resistance.length > 0 ? Math.min(...resistance.filter((r) => r > spot)) : 0;
  if (nearestSup > 0) {
    const distPct = ((spot - nearestSup) / spot) * 100;
    if (distPct < 0.5) {
      score += 12;
      reasons.push(`Spot near support ${nearestSup} — bounce setup`);
    }
  }
  if (nearestRes > 0) {
    const distPct = ((nearestRes - spot) / spot) * 100;
    if (distPct < 0.5) {
      score += 12;
      reasons.push(`Spot near resistance ${nearestRes} — breakout/rejection setup`);
    }
  }
  return Math.min(25, Math.max(score, 8));
}

// ─── Volume (25 pts) ────────────────────────────────────────────────────────

function scoreVolume(
  chain: OptionChainStrike[],
  targetStrikes: number[],
  reasons: string[],
): number {
  if (chain.length === 0) return 8;
  const maxVol = Math.max(...chain.map((s) => Math.max(s.ce.volume, s.pe.volume)), 1);

  if (targetStrikes.length === 0) {
    const totalVol = chain.reduce((sum, s) => sum + s.ce.volume + s.pe.volume, 0);
    if (totalVol > 0) {
      reasons.push("Active volume across chain");
      return 15;
    }
    return 8;
  }

  let volScore = 0;
  for (const strike of targetStrikes) {
    const row = chain.find((s) => s.strike === strike);
    if (!row) continue;
    const ratio = Math.max(row.ce.volume, row.pe.volume) / maxVol;
    if (ratio > 0.5) {
      volScore += 12;
      reasons.push(`${strike}: high participation`);
    } else if (ratio > 0.2) {
      volScore += 7;
    } else {
      volScore += 3;
    }
  }

  return Math.min(25, volScore);
}

// ─── utils ──────────────────────────────────────────────────────────────────

function formatLakh(n: number): string {
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(1)}Cr`;
  if (n >= 100_000) return `${(n / 100_000).toFixed(1)}L`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}
