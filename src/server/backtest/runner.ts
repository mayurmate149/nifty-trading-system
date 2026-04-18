/**
 * Backtest — Runner
 *
 * Replays historical data day-by-day, applying strategy entry/exit rules.
 */

import { BacktestRequest, BacktestTrade } from "@/types/backtest";

export async function runBacktest(request: BacktestRequest): Promise<BacktestTrade[]> {
  // TODO: Phase 7
  // For each trading day in dateRange:
  //   1. Load OHLC + options chain for that day
  //   2. Apply entry rules (strategy-specific)
  //   3. If entry triggered, track position
  //   4. Apply exit rules (SL, TP, trailing, expiry)
  //   5. Record trade result
  // Return array of BacktestTrade
  throw new Error("Not implemented — Phase 7");
}
