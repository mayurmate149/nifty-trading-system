/**
 * Backtest — Metrics Calculator
 *
 * Computes strategy performance metrics from trade results.
 */

import { BacktestTrade, BacktestSummary } from "@/types/backtest";

export function calculateMetrics(trades: BacktestTrade[]): BacktestSummary {
  // TODO: Phase 7
  // 1. Win rate = winning trades / total trades * 100
  // 2. Avg return per trade = mean(pnlPercent)
  // 3. Max drawdown = largest peak-to-trough in cumulative P&L
  // 4. Profit factor = gross profit / gross loss
  // 5. Sharpe approx = mean(daily returns) / std(daily returns) * sqrt(252)
  throw new Error("Not implemented — Phase 7");
}
