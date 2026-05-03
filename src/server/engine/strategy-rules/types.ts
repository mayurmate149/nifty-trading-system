/**
 * Strategy Rule System — Types
 *
 * Each strategy is expressed as a set of typed predicates ("rules") over a
 * shared evaluation context. A rule can be marked critical (must pass for
 * READY) and weighted (how much it contributes to the aggregate match %).
 *
 * Groups align to how a professional trader reads the tape:
 *   trend        — EMA, SuperTrend, trend classifier, Bollinger expansion
 *   momentum     — RSI, MACD, stochastic, ROC, VWAP position
 *   volatility   — IV percentile, VIX, Bollinger width / squeeze
 *   option_chain — PCR, OI walls, OI flow, IV skew, max pain
 *   structure    — S/R proximity, DTE, pivot, spot location
 *   volume       — volume spike, candle body, participation
 */

import type { MarketIndicators, OptionsChainResponse } from "@/types/market";
import type { TechnicalSnapshot } from "@/server/market-data/technicals";
import type { ProfessionalIndicatorBundle } from "@/server/market-data/professional-indicators";

export type RuleGroup =
  | "trend"
  | "momentum"
  | "volatility"
  | "option_chain"
  | "structure"
  | "volume";

/** How heavily a rule weighs into the aggregate match score. */
export type RuleWeight = 1 | 2 | 3;

/**
 * Derived option-chain helpers pre-computed once per snapshot so every
 * strategy can read the same, consistent view.
 */
export interface ChainDerived {
  atmStrike: number;
  maxCallOI: { strike: number; oi: number };
  maxPutOI: { strike: number; oi: number };
  maxPain: number;
  /** pcrOI from chain (preferred over indicator's pcr which is same source). */
  pcrOI: number;
  pcrVolume: number;
  ivSkewATM: number;
  atmStraddle: number;
  /** 1-sigma expected move from the ATM straddle. */
  expectedMovePts: number;
}

export interface StrategyEvalContext {
  spot: number;
  indicators: MarketIndicators;
  technicals: TechnicalSnapshot;
  professional: ProfessionalIndicatorBundle;
  chain: OptionsChainResponse;
  chainDerived: ChainDerived;
}

export interface RuleEvaluation {
  passed: boolean;
  detail: string;
}

export interface Rule {
  id: string;
  group: RuleGroup;
  label: string;
  weight: RuleWeight;
  /** Must pass for READY; failing disqualifies regardless of aggregate score. */
  critical: boolean;
  evaluate: (ctx: StrategyEvalContext) => RuleEvaluation;
}

export interface StrategyRules {
  key: StrategyKey;
  name: string;
  icon: string;
  bias: "DEBIT" | "CREDIT";
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  legs: number;
  riskProfile: "LIMITED" | "UNLIMITED";
  summary: string;
  rules: Rule[];
  exitRules: {
    stopLoss: string;
    target: string;
    trailingSL: string;
    timeExit: string;
  };
}

export type StrategyKey =
  | "BULL_CALL_SPREAD"
  | "BULL_PUT_SPREAD"
  | "BEAR_PUT_SPREAD"
  | "BEAR_CALL_SPREAD"
  | "IRON_FLY"
  | "SHORT_IRON_CONDOR"
  | "DIRECTIONAL_BUY"
  | "NAKED_BUY";
