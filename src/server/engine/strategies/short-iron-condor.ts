/**
 * Short Iron Condor — CREDIT, neutral, 4 legs, defined risk.
 *
 *   SELL OTM CE + BUY further OTM CE   (bear-call spread)
 *   SELL OTM PE + BUY further OTM PE   (bull-put spread)
 *
 * Wider profit zone than Iron Fly but smaller credit — best in range-bound
 * regimes with strong call+put walls framing the expected range.
 */

import type { StrategyRules } from "../strategy-rules/types";
import {
  bollingerSqueezeRule,
  dteBetweenRule,
  hasWallRule,
  indicatorTrendRule,
  ivPercentileRule,
  macdBiasRule,
  oiFlowRule,
  pcrBetweenRule,
  rsiBetweenRule,
  vixBetweenRule,
} from "../strategy-rules/common-rules";

export const shortIronCondorRules: StrategyRules = {
  key: "SHORT_IRON_CONDOR",
  name: "Short Iron Condor",
  icon: "🦅",
  bias: "CREDIT",
  direction: "NEUTRAL",
  legs: 4,
  riskProfile: "LIMITED",
  summary: "Sell OTM call spread + OTM put spread — wide range credit with defined risk.",
  rules: [
    // Trend (regime is the one critical rule — wide condors tolerate some IV)
    indicatorTrendRule(["range-bound"], 0, 3, true),
    bollingerSqueezeRule(4.5, 1),
    // Momentum
    rsiBetweenRule(35, 65, 2, false),
    macdBiasRule("NEUTRAL", 2, false),
    // Volatility (weighted; not the kill-switch so low-IV range days still rate)
    ivPercentileRule(25, 90, 3, false),
    vixBetweenRule(12, 28, 1),
    // Option chain
    pcrBetweenRule(0.7, 1.3, 2),
    hasWallRule("call", "ABOVE", 2),
    hasWallRule("put", "BELOW", 2),
    oiFlowRule("call", "BUILDUP", 1),
    oiFlowRule("put", "BUILDUP", 1),
    // Structure
    dteBetweenRule(3, 10, 2, false),
  ],
  exitRules: {
    stopLoss: "Exit at 2× credit received or if either short strike is breached",
    target: "Close at 50-65% of max profit",
    trailingSL: "After 40% profit, trail SL to breakeven",
    timeExit: "Close 1-2 days before expiry",
  },
};
