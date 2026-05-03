/**
 * Naked Buy (CE/PE) — DEBIT, single-leg, OTM lotto/breakout.
 *
 *   BUY OTM Call on strong bullish breakout, BUY OTM Put on strong bearish
 *   breakdown. Bigger reward, lower win rate. Needs:
 *     - Very strong, confirmed trend (EMA + SuperTrend + momentum all agree)
 *     - Cheap IV so the premium isn't bloated
 *     - Bollinger expansion (range is opening up)
 *     - Volume confirmation on the last bar
 */

import type { StrategyRules } from "../strategy-rules/types";
import {
  bollingerExpansionRule,
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

export const nakedBuyRules: StrategyRules = {
  key: "NAKED_BUY",
  name: "Naked Buy CE/PE",
  icon: "🚀",
  bias: "DEBIT",
  direction: "NEUTRAL", // side resolved from live trend at strike-selection
  legs: 1,
  riskProfile: "LIMITED",
  summary: "Buy OTM CE or PE on a strong breakout — lotto-grade R:R with tight SL.",
  rules: [
    // Directional trend is the one critical gate; rest contribute to match %.
    directionalTrendRule(50, 3, true),
    emaAlignsWithTrendRule(3, false),
    superTrendAlignsWithTrendRule(3, false),
    rsiAlignsWithTrendRule(2),
    macdAlignsWithTrendRule(2),
    vwapAlignsWithTrendRule(2),
    momentumAlignsWithTrendRule(0.4, 2),
    // Volatility (want cheap OTM but don't kill the card if slightly rich)
    ivPercentileRule(5, 45, 3, false),
    bollingerExpansionRule(2.2, 2),
    volumeSpikeRule(2),
    dteBetweenRule(2, 8, 1, false),
  ],
  exitRules: {
    stopLoss: "30% of premium paid — cut losers fast; exit if trend flips",
    target: "2×-3× premium (or partial book at 100%)",
    trailingSL: "After 75% gain, trail SL to cost",
    timeExit: "Close by 3:00 PM intraday or before 2 days to expiry",
  },
};
