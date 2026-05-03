// ─── Strategy & Trade Suggestion Types ──────

export type StrategyType =
  | "BULL_CALL_SPREAD"
  | "BULL_PUT_SPREAD"
  | "BEAR_PUT_SPREAD"
  | "BEAR_CALL_SPREAD"
  | "IRON_FLY"
  | "SHORT_IRON_CONDOR"
  | "DIRECTIONAL_BUY"
  | "NAKED_BUY";

export type LegType =
  | "BUY_CALL"
  | "SELL_CALL"
  | "BUY_PUT"
  | "SELL_PUT";

export type ConfidenceTier = "HIGH" | "MEDIUM" | "LOW";

export type TradeDirection = "BULLISH" | "BEARISH" | "NEUTRAL";

/** Whether the strategy collects net premium (CREDIT) or pays net premium (DEBIT). */
export type StrategyBias = "CREDIT" | "DEBIT";

export interface StrategyLeg {
  type: LegType;
  strike: number;
  premium: number; // LTP of the option
  iv: number;
  oi: number;
  qty: number;
  lotSize: number;
}

export interface TradeSuggestion {
  id: string;
  strategy: StrategyType;
  direction: TradeDirection;
  legs: StrategyLeg[];
  confidence: number;          // 0–100
  confidenceTier: ConfidenceTier;
  expectedRiskReward: number;  // e.g. 2.5 means 2.5:1
  maxProfit: number;           // ₹ for one lot
  maxLoss: number;             // ₹ for one lot
  breakeven: number[];         // breakeven prices
  netPremium: number;          // net credit (+) or debit (-)
  rationale: string[];         // human-readable reasoning
  entryConditions: string[];   // conditions that triggered this
  exitRules: {
    stopLoss: string;
    target: string;
    trailingSL: string;
    timeExit: string;
  };
  marketContext: {
    spot: number;
    atm: number;
    vix: number;
    trend: string;
    pcr: number;
    ivPercentile: number;
  };
  createdAt: string;
}

export interface SuggestRequest {
  symbol: string;
  expiry?: string;
  strategies?: StrategyType[];  // empty = scan all
  riskParams: {
    maxCapitalPercent: number;
    capitalAmount?: number;
    confidenceThreshold: number; // default 60
    lotSize?: number;           // NIFTY=75
  };
}

export interface SuggestResponse {
  suggestions: TradeSuggestion[];
  scannedAt: string;
  marketSnapshot: {
    spot: number;
    vix: number;
    trend: string;
    pcr: number;
    ivPercentile: number;
  };
}

// ─── Strategy Definition Metadata ───────────

export interface StrategyMeta {
  type: StrategyType;
  name: string;
  description: string;
  icon: string;
  legs: number;
  bias: StrategyBias;
  direction: TradeDirection[];
  riskProfile: "LIMITED" | "UNLIMITED";
  timeframe: "INTRADAY" | "POSITIONAL" | "BOTH";
}

export const STRATEGY_META: Record<StrategyType, StrategyMeta> = {
  BULL_CALL_SPREAD: {
    type: "BULL_CALL_SPREAD",
    name: "Bull Call Spread",
    description: "Buy ATM CE + sell OTM CE — cheap, capped-risk bullish debit.",
    icon: "📈",
    legs: 2,
    bias: "DEBIT",
    direction: ["BULLISH"],
    riskProfile: "LIMITED",
    timeframe: "BOTH",
  },
  BULL_PUT_SPREAD: {
    type: "BULL_PUT_SPREAD",
    name: "Bull Put Spread",
    description: "Sell OTM PE + buy further OTM PE — bullish credit spread.",
    icon: "🟢",
    legs: 2,
    bias: "CREDIT",
    direction: ["BULLISH"],
    riskProfile: "LIMITED",
    timeframe: "BOTH",
  },
  BEAR_PUT_SPREAD: {
    type: "BEAR_PUT_SPREAD",
    name: "Bear Put Spread",
    description: "Buy ATM PE + sell OTM PE — cheap, capped-risk bearish debit.",
    icon: "📉",
    legs: 2,
    bias: "DEBIT",
    direction: ["BEARISH"],
    riskProfile: "LIMITED",
    timeframe: "BOTH",
  },
  BEAR_CALL_SPREAD: {
    type: "BEAR_CALL_SPREAD",
    name: "Bear Call Spread",
    description: "Sell OTM CE + buy further OTM CE — bearish credit spread.",
    icon: "🔴",
    legs: 2,
    bias: "CREDIT",
    direction: ["BEARISH"],
    riskProfile: "LIMITED",
    timeframe: "BOTH",
  },
  IRON_FLY: {
    type: "IRON_FLY",
    name: "Iron Fly",
    description: "Sell ATM straddle + buy wings — pinned-range credit with capped loss.",
    icon: "🦋",
    legs: 4,
    bias: "CREDIT",
    direction: ["NEUTRAL"],
    riskProfile: "LIMITED",
    timeframe: "BOTH",
  },
  SHORT_IRON_CONDOR: {
    type: "SHORT_IRON_CONDOR",
    name: "Short Iron Condor",
    description: "Sell OTM call spread + OTM put spread — wide-range neutral credit.",
    icon: "🦅",
    legs: 4,
    bias: "CREDIT",
    direction: ["NEUTRAL"],
    riskProfile: "LIMITED",
    timeframe: "POSITIONAL",
  },
  DIRECTIONAL_BUY: {
    type: "DIRECTIONAL_BUY",
    name: "Directional Buy",
    description: "Buy ATM / slight-ITM CE or PE on a confirmed, strong trend with cheap IV.",
    icon: "🎯",
    legs: 1,
    bias: "DEBIT",
    direction: ["BULLISH", "BEARISH"],
    riskProfile: "LIMITED",
    timeframe: "BOTH",
  },
  NAKED_BUY: {
    type: "NAKED_BUY",
    name: "Naked Buy CE/PE",
    description: "Buy OTM CE or PE on a strong breakout — lotto-grade R:R.",
    icon: "🚀",
    legs: 1,
    bias: "DEBIT",
    direction: ["BULLISH", "BEARISH"],
    riskProfile: "LIMITED",
    timeframe: "INTRADAY",
  },
};
