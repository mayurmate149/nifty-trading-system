/**
 * Directional Buy — DEBIT, single-leg, trend-aligned.
 *
 *   BUY ATM / slightly-ITM Call (bullish trend) or Put (bearish trend).
 *
 * The strategy is direction-agnostic: side (CE/PE) is picked at strike-
 * selection time from the live trend. The rule stack therefore uses trend-
 * aligned predicates rather than hard-coding a direction.
 */

import type { StrategyRules } from "../strategy-rules/types";
import {
  directionalTrendRule,
  dteBetweenRule,
  emaAlignsWithTrendRule,
  ivPercentileRule,
  macdAlignsWithTrendRule,
  momentumAlignsWithTrendRule,
  rsiAlignsWithTrendRule,
  superTrendAlignsWithTrendRule,
  volumeSpikeRule,
  vwapAlignsWithTrendRule,
} from "../strategy-rules/common-rules";

export const directionalBuyRules: StrategyRules = {
  key: "DIRECTIONAL_BUY",
  name: "Directional Buy",
  icon: "🎯",
  bias: "DEBIT",
  direction: "NEUTRAL", // side resolved from live trend at strike-selection
  legs: 1,
  riskProfile: "LIMITED",
  summary: "Buy ATM / slight-ITM CE or PE on a confirmed, strong trend with cheap IV.",
  rules: [
    // A directional debit buy *must* have a live directional trend — the
    // one critical gate. Everything else weighs toward match %.
    directionalTrendRule(45, 3, true),
    emaAlignsWithTrendRule(3, false),
    superTrendAlignsWithTrendRule(3, false),
    rsiAlignsWithTrendRule(2),
    macdAlignsWithTrendRule(2),
    vwapAlignsWithTrendRule(2),
    momentumAlignsWithTrendRule(0.3, 2),
    ivPercentileRule(5, 55, 3, false),
    volumeSpikeRule(1),
    dteBetweenRule(2, 10, 1, false),
  ],
  exitRules: {
    stopLoss: "SL at 30% of premium paid; exit if trend flips on EMA / SuperTrend",
    target: "50-100% premium gain, or trail once in profit",
    trailingSL: "After 30% gain, trail SL to cost",
    timeExit: "Close before 2 days to expiry (theta burn)",
  },
};
