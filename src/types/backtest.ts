// ─── Backtest Types ─────────────────────────

export interface BacktestRequest {
  strategy: string;
  symbol: string;
  dateRange: {
    from: string;  // ISO date
    to: string;
  };
  params: {
    width: number;
    targetPct: number;
    stopLossPct: number;
    [key: string]: number | string;
  };
}

export interface BacktestTrade {
  entryTime: string;
  exitTime: string;
  pnlPercent: number;
  entryPrice?: number;
  exitPrice?: number;
  exitReason?: "SL" | "TP" | "TRAIL" | "EXPIRY";
}

export interface BacktestSummary {
  winRate: number;
  avgReturnPerTrade: number;
  maxDrawdownPercent: number;
  totalTrades: number;
  profitFactor?: number;
  sharpeApprox?: number;
}

export interface BacktestResponse {
  summary: BacktestSummary;
  trades: BacktestTrade[];
}
