/**
 * Bear Call Spread — CREDIT, bearish, 2 legs, defined risk.
 *
 *   SELL near-ATM CE  +  BUY further OTM CE   (net credit)
 */

import type { StrategyRules } from "../strategy-rules/types";
import {
  bollingerExpansionRule,
  dteBetweenRule,
  emaCrossoverRule,
  hasWallRule,
  indicatorTrendRule,
  ivPercentileRule,
  macdBiasRule,
  oiFlowRule,
  pcrBetweenRule,
  rsiBetweenRule,
  spotVsLevelRule,
  superTrendRule,
  vixBetweenRule,
  vwapPositionRule,
} from "../strategy-rules/common-rules";

export const bearCallSpreadRules: StrategyRules = {
  key: "BEAR_CALL_SPREAD",
  name: "Bear Call Spread",
  icon: "🔴",
  bias: "CREDIT",
  direction: "BEARISH",
  legs: 2,
  riskProfile: "LIMITED",
  summary: "Sell OTM CE + buy further OTM CE — collect credit with bearish-to-neutral bias.",
  rules: [
    // Trend (weighted but not critical; credit spreads tolerate drift)
    indicatorTrendRule(["trend-down", "range-bound"], 0, 3, false),
    emaCrossoverRule("BEARISH", 3, false),
    superTrendRule("SELL", 2, false),
    // Momentum
    rsiBetweenRule(30, 58, 2, false),
    macdBiasRule("BEARISH", 2, false),
    vwapPositionRule("BELOW", 2, false),
    // Volatility
    ivPercentileRule(30, 85, 3, true),
    vixBetweenRule(11, 28, 1),
    bollingerExpansionRule(1.2, 1),
    // Option chain
    pcrBetweenRule(0.4, 1.1, 2),
    oiFlowRule("call", "BUILDUP", 2),
    hasWallRule("call", "ABOVE", 2),
    // Structure
    spotVsLevelRule("resistance", "BELOW", 0, 1),
    dteBetweenRule(2, 10, 2, false),
  ],
  exitRules: {
    stopLoss: "Exit at 2× credit received or if short CE strike is breached",
    target: "Close at 50-60% of max profit",
    trailingSL: "After 40% gain, trail SL to breakeven",
    timeExit: "Close 1-2 days before expiry",
  },
};
