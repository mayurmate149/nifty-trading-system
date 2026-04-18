// ─── Market Data Types ──────────────────────

export interface OptionGreeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

export interface OptionChainRow {
  strike: number;
  oi: number;
  changeInOi: number;
  volume: number;
  iv: number;
  ltp: number;
  bidPrice?: number;
  askPrice?: number;
  greeks?: OptionGreeks;
}

export interface OptionChainStrike {
  strike: number;
  ce: OptionChainRow & { greeks: OptionGreeks };
  pe: OptionChainRow & { greeks: OptionGreeks };
}

export interface OptionsChainResponse {
  underlying: string;
  expiry: string;
  spot: number;
  vix: number;
  atmStrike: number;
  pcr: number;
  totalCallOI: number;
  totalPutOI: number;
  maxCallOIStrike: number;
  maxPutOIStrike: number;
  chain: OptionChainStrike[];
  // Legacy flat arrays kept for backward compat
  calls: OptionChainRow[];
  puts: OptionChainRow[];
}

export interface MarketIndicators {
  vix: number;
  spot: number;
  spotChange: number;
  spotChangePct: number;
  support: number[];
  resistance: number[];
  pivotPoint: number;
  trend: TrendLabel;
  trendStrength: number; // 0-100
  pcr: number;
  ivPercentile: number;
  daysToExpiry: number;
  expiry: string;
}

export type TrendLabel = "trend-up" | "trend-down" | "range-bound";

export interface MarketTick {
  symbol: string;
  ltp: number;
  volume: number;
  oi: number;
  timestamp: number;
}

export interface OHLCBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketSnapshot {
  nifty: number;
  niftyPrevClose: number;
  bankNifty: number;
  bankNiftyPrevClose: number;
  vix: number;
  iv: number;
  daysToExpiry: number;
  expiry: string;
  positionsCount: number;
  totalPnL: number;
  margin: {
    AvailableMargin: number;
    UsedMargin: number;
    NetMargin: number;
  };
  tickRate: number;
  trend: string;
}

// ─── Analytics Types ────────────────────────

export interface PortfolioSummary {
  totalCapitalDeployed: number;
  totalPnl: number;
  totalPnlPct: number;
  marginUsed: number;
  marginAvailable: number;
  marginUtilization: number;
  positionsCount: number;
  openPositions: number;
  dayHigh: number;
  dayLow: number;
}

export interface GreeksExposure {
  totalDelta: number;
  totalGamma: number;
  totalTheta: number;
  totalVega: number;
  perPosition: {
    positionId: string;
    symbol: string;
    quantity: number;
    delta: number;
    gamma: number;
    theta: number;
    vega: number;
  }[];
}

export interface PnLDataPoint {
  time: string;
  pnl: number;
  spot: number;
}

export interface PayoffPoint {
  spot: number;
  payoff: number;
}

export interface IVSkewPoint {
  strike: number;
  callIV: number;
  putIV: number;
}

