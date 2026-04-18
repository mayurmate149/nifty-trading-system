// ─── Risk & Auto-Exit Types ─────────────────

export type AutoExitMode = "ENABLE" | "DISABLE";

export interface AutoExitConfig {
  mode: AutoExitMode;
  stopLossPercent: number;      // default 1.0 — initial SL (e.g. -1%)
  trailOffsetPercent: number;   // default 1.0 — SL trails at (profit - offset)
  profitFloorPercent: number;   // default 2.0 — once profit hits this, SL never goes below it
  capitalOverride?: number;     // optional — if set, use this as portfolio capital instead of broker margin
  //
  // Progressive trailing logic:
  //   Initial SL        = -stopLossPercent  (e.g. -1%)
  //   Profit >= 1%  →  SL = 0%  (breakeven)
  //   Profit >= 2%  →  SL = 2%  (profit floor locks in — SL jumps to floor)
  //   Profit >= 3%  →  SL = 2%  (normal trail = 2%, but floor = 2% anyway)
  //   Profit >= 4%  →  SL = 3%  (normal trail resumes above floor)
  //   General:  SL = max(floor(profit) - trailOffsetPercent, profitFloorPercent)
  //             once profit has ever reached profitFloorPercent.
  //   SL only ratchets UP, never down.
  //
  // Capital priority: capitalOverride > broker UsedMargin > sum(position capital)
  //
}

export interface AutoExitState {
  watchId: string;
  positionId: string;
  active: boolean;
  config: AutoExitConfig;
  currentSLPercent: number;     // dynamically updated as trailing kicks in
  peakProfitPercent: number;    // highest P&L seen since watch started
}

export interface RiskSummary {
  totalCapitalDeployed: number;
  totalUnrealizedPnl: number;
  maxPossibleLoss: number;
  positionsWatched: number;
  positionsTotal: number;
}
