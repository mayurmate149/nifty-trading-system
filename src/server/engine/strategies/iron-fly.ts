/**
 * Iron Fly (Iron Butterfly) — CREDIT, neutral, 4 legs, defined risk.
 *
 *   SELL ATM CE + SELL ATM PE + BUY OTM CE wing + BUY OTM PE wing
 *
 * Wants a pinned/quiet market with elevated IV so the body premium pays well
 * and the spot has the best chance of hugging ATM at expiry.
 */

import type { StrategyRules } from "../strategy-rules/types";
import {
  bollingerSqueezeRule,
  dteBetweenRule,
  indicatorTrendRule,
  ivPercentileRule,
  macdBiasRule,
  maxPainRelativeToSpot,
  pcrBetweenRule,
  rsiBetweenRule,
  stochasticZoneRule,
  vixBetweenRule,
} from "../strategy-rules/common-rules";

export const ironFlyRules: StrategyRules = {
  key: "IRON_FLY",
  name: "Iron Fly",
  icon: "🦋",
  bias: "CREDIT",
  direction: "NEUTRAL",
  legs: 4,
  riskProfile: "LIMITED",
  summary: "Sell ATM straddle + buy wings — pinned-range credit with capped loss.",
  rules: [
    // Trend (must be quiet — keep regime as the one critical rule)
    indicatorTrendRule(["range-bound"], 0, 3, true),
    bollingerSqueezeRule(3.5, 2),
    // Momentum must be neutral
    rsiBetweenRule(42, 58, 2, false),
    macdBiasRule("NEUTRAL", 2, false),
    stochasticZoneRule("NEUTRAL", 1),
    // Volatility (rich body premium — weighted but not critical so low IV
    // doesn't kill the card; it just reduces match %)
    ivPercentileRule(30, 95, 3, false),
    vixBetweenRule(12, 28, 1),
    // Option chain
    pcrBetweenRule(0.8, 1.25, 2),
    maxPainRelativeToSpot("AT_SPOT", 0.004, 2),
    // Structure
    dteBetweenRule(2, 6, 2, false),
  ],
  exitRules: {
    stopLoss: "Combined position at 1.8×–2× credit, or spot breaches either wing",
    target: "40-55% of credit — don't wait for full pin",
    trailingSL: "After 30% profit, trail SL to cost",
    timeExit: "Close before the last 90 minutes of expiry day",
  },
};
