// ─── Strategy & Trade Suggestion Types ──────

export type StrategyType =
  | "IRON_CONDOR"
  | "CREDIT_SPREAD"
  | "SHORT_STRADDLE"
  | "SHORT_STRANGLE"
  | "SCALP_SELL"
  | "DEBIT_SPREAD"
  | "DIRECTIONAL_BUY";

export type LegType =
  | "BUY_CALL"
  | "SELL_CALL"
  | "BUY_PUT"
  | "SELL_PUT";

export type ConfidenceTier = "HIGH" | "MEDIUM" | "LOW";

export type TradeDirection = "BULLISH" | "BEARISH" | "NEUTRAL";

/** Whether the strategy is a net-premium seller or buyer */
export type StrategyBias = "SELLER" | "BUYER";

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
  idealConditions: {
    trends: string[];
    pcrRange: [number, number];
    ivPercentileRange: [number, number];
    vixRange: [number, number];
  };
  riskProfile: "LIMITED" | "UNLIMITED";
  timeframe: "INTRADAY" | "POSITIONAL" | "BOTH";
}

export const STRATEGY_META: Record<StrategyType, StrategyMeta> = {
  IRON_CONDOR: {
    type: "IRON_CONDOR",
    name: "Iron Condor",
    description: "Sell OTM call + put spreads; collect premium in range-bound markets",
    icon: "🦅",
    legs: 4,
    bias: "SELLER",
    direction: ["NEUTRAL"],
    idealConditions: {
      trends: ["range-bound"],
      pcrRange: [0.7, 1.3],
      ivPercentileRange: [30, 85],
      vixRange: [12, 25],
    },
    riskProfile: "LIMITED",
    timeframe: "POSITIONAL",
  },
  CREDIT_SPREAD: {
    type: "CREDIT_SPREAD",
    name: "Credit Spread",
    description: "Sell OTM spread for directional bias; collect premium with limited risk",
    icon: "💳",
    legs: 2,
    bias: "SELLER",
    direction: ["BULLISH", "BEARISH"],
    idealConditions: {
      trends: ["trend-up", "trend-down"],
      pcrRange: [0.5, 1.5],
      ivPercentileRange: [25, 85],
      vixRange: [12, 28],
    },
    riskProfile: "LIMITED",
    timeframe: "BOTH",
  },
  SHORT_STRADDLE: {
    type: "SHORT_STRADDLE",
    name: "Short Straddle",
    description: "Sell ATM call + put; profit from theta decay in sideways markets",
    icon: "⚡",
    legs: 2,
    bias: "SELLER",
    direction: ["NEUTRAL"],
    idealConditions: {
      trends: ["range-bound"],
      pcrRange: [0.75, 1.25],
      ivPercentileRange: [40, 90],
      vixRange: [13, 25],
    },
    riskProfile: "UNLIMITED",
    timeframe: "BOTH",
  },
  SHORT_STRANGLE: {
    type: "SHORT_STRANGLE",
    name: "Short Strangle",
    description: "Sell OTM call + put; wider profit zone, theta decay",
    icon: "🔀",
    legs: 2,
    bias: "SELLER",
    direction: ["NEUTRAL"],
    idealConditions: {
      trends: ["range-bound"],
      pcrRange: [0.7, 1.3],
      ivPercentileRange: [35, 90],
      vixRange: [13, 25],
    },
    riskProfile: "UNLIMITED",
    timeframe: "BOTH",
  },
  SCALP_SELL: {
    type: "SCALP_SELL",
    name: "Scalp Sell",
    description: "Quick intraday option sell for fast theta/premium capture",
    icon: "⏱️",
    legs: 1,
    bias: "SELLER",
    direction: ["BULLISH", "BEARISH"],
    idealConditions: {
      trends: ["range-bound", "trend-up", "trend-down"],
      pcrRange: [0.5, 1.5],
      ivPercentileRange: [20, 80],
      vixRange: [10, 30],
    },
    riskProfile: "UNLIMITED",
    timeframe: "INTRADAY",
  },
  DEBIT_SPREAD: {
    type: "DEBIT_SPREAD",
    name: "Debit Spread",
    description: "Buy ATM + sell OTM for directional move with capped risk (hedging)",
    icon: "�",
    legs: 2,
    bias: "BUYER",
    direction: ["BULLISH", "BEARISH"],
    idealConditions: {
      trends: ["trend-up", "trend-down"],
      pcrRange: [0.4, 1.6],
      ivPercentileRange: [5, 35],
      vixRange: [8, 18],
    },
    riskProfile: "LIMITED",
    timeframe: "BOTH",
  },
  DIRECTIONAL_BUY: {
    type: "DIRECTIONAL_BUY",
    name: "Directional Buy",
    description: "Buy ATM/OTM option — only for very strong breakouts (hedge/lotto)",
    icon: "🎯",
    legs: 1,
    bias: "BUYER",
    direction: ["BULLISH", "BEARISH"],
    idealConditions: {
      trends: ["trend-up", "trend-down"],
      pcrRange: [0.3, 1.7],
      ivPercentileRange: [5, 30],
      vixRange: [8, 16],
    },
    riskProfile: "LIMITED",
    timeframe: "BOTH",
  },
};
