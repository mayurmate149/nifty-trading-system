/**
 * Bull Call Spread — DEBIT, bullish, 2 legs, capped risk/reward.
 *
 *   BUY ATM CE  +  SELL OTM CE   (net debit)
 *
 * We want a confirmed up-trend but cheap volatility so the debit doesn't eat
 * the trade, plus option-chain signals that support the bull case (PCR up,
 * put-writing buildup, max pain ≥ spot).
 */

import type { StrategyRules } from "../strategy-rules/types";
import {
  bollingerExpansionRule,
  candleDirectionRule,
  dteBetweenRule,
  emaCrossoverRule,
  hasWallRule,
  indicatorTrendRule,
  ivPercentileRule,
  macdBiasRule,
  maxPainRelativeToSpot,
  momentumMinRule,
  oiFlowRule,
  pcrBetweenRule,
  rsiBetweenRule,
  spotVsLevelRule,
  superTrendRule,
  volumeSpikeRule,
  vwapPositionRule,
} from "../strategy-rules/common-rules";

export const bullCallSpreadRules: StrategyRules = {
  key: "BULL_CALL_SPREAD",
  name: "Bull Call Spread",
  icon: "📈",
  bias: "DEBIT",
  direction: "BULLISH",
  legs: 2,
  riskProfile: "LIMITED",
  summary: "Buy ATM CE + sell OTM CE for a cheap, capped-risk bull trade.",
  rules: [
    // Trend (heavy weight but not critical — a mild pullback in a bull setup
    // shouldn't auto-disqualify a cheap debit spread)
    indicatorTrendRule(["trend-up", "range-bound"], 0, 3, false),
    emaCrossoverRule("BULLISH", 3, false),
    superTrendRule("BUY", 2, false),
    bollingerExpansionRule(1.8, 1),
    // Momentum
    rsiBetweenRule(50, 72, 2, false),
    macdBiasRule("BULLISH", 2, false),
    vwapPositionRule("ABOVE", 2, false),
    momentumMinRule(0.25, "UP", 2),
    // Volatility (cheap options needed for debit)
    ivPercentileRule(5, 45, 3, true),
    // Option chain
    pcrBetweenRule(0.9, 1.8, 2),
    oiFlowRule("put", "BUILDUP", 2),
    maxPainRelativeToSpot("ABOVE_SPOT", 0.003, 1),
    hasWallRule("put", "BELOW", 1),
    // Structure
    spotVsLevelRule("support", "ABOVE", 0, 1),
    dteBetweenRule(2, 20, 1, false),
    // Volume
    candleDirectionRule("BULLISH", 1),
    volumeSpikeRule(1),
  ],
  exitRules: {
    stopLoss: "Exit at 50% of debit paid or if EMA crossover flips bearish",
    target: "Close at 60-80% of max profit (spread width − debit)",
    trailingSL: "After 40% gain, trail SL to cost + 20%",
    timeExit: "Close 1 day before expiry to avoid pin risk",
  },
};
