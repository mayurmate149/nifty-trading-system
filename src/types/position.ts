// ─── Position Types ─────────────────────────

export type OptionType = "CALL" | "PUT";
export type PositionStatus = "OPEN" | "CLOSED";

export interface Position {
  positionId: string;
  symbol: string;
  strike: number;
  optionType: OptionType;
  status: PositionStatus;
  quantity: number;
  avgPrice: number;
  ltp: number;
  pl: number;
  capitalDeployed: number;
  maxLossPercent: number;
  maxGainPercent: number;
  exchange?: string;       // "N" (NSE), "B" (BSE)
  exchangeType?: string;   // "D" (derivatives), "C" (cash)
  isIntraday?: boolean;    // MIS (true) vs NRML (false)
}

export interface PositionsResponse {
  positions: Position[];
}
