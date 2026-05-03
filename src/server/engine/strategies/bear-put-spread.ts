/**
 * Bear Put Spread — DEBIT, bearish, 2 legs, capped risk/reward.
 *
 *   BUY ATM PE  +  SELL OTM PE   (net debit)
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

export const bearPutSpreadRules: StrategyRules = {
  key: "BEAR_PUT_SPREAD",
  name: "Bear Put Spread",
  icon: "📉",
  bias: "DEBIT",
  direction: "BEARISH",
  legs: 2,
  riskProfile: "LIMITED",
  summary: "Buy ATM PE + sell OTM PE for a cheap, capped-risk bear trade.",
  rules: [
    // Trend (weighted but not critical)
    indicatorTrendRule(["trend-down", "range-bound"], 0, 3, false),
    emaCrossoverRule("BEARISH", 3, false),
    superTrendRule("SELL", 2, false),
    bollingerExpansionRule(1.8, 1),
    // Momentum
    rsiBetweenRule(28, 55, 2, false),
    macdBiasRule("BEARISH", 2, false),
    vwapPositionRule("BELOW", 2, false),
    momentumMinRule(0.25, "DOWN", 2),
    // Volatility
    ivPercentileRule(5, 48, 3, true),
    // Option chain
    pcrBetweenRule(0.3, 1.0, 2),
    oiFlowRule("call", "BUILDUP", 2),
    maxPainRelativeToSpot("BELOW_SPOT", 0.003, 1),
    hasWallRule("call", "ABOVE", 1),
    // Structure
    spotVsLevelRule("resistance", "BELOW", 0, 1),
    dteBetweenRule(2, 20, 1, false),
    // Volume
    candleDirectionRule("BEARISH", 1),
    volumeSpikeRule(1),
  ],
  exitRules: {
    stopLoss: "Exit at 50% of debit paid or if EMA crossover flips bullish",
    target: "Close at 60-80% of max profit (spread width − debit)",
    trailingSL: "After 40% gain, trail SL to cost + 20%",
    timeExit: "Close 1 day before expiry to avoid pin risk",
  },
};
