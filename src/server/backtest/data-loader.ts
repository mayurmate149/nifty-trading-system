/**
 * Backtest — Data Loader
 *
 * Fetches and stores historical OHLC + EOD options chain snapshots.
 */

import { OHLCBar } from "@/types/market";

export async function loadHistoricalOHLC(
  symbol: string,
  from: string,
  to: string
): Promise<OHLCBar[]> {
  // TODO: Phase 7
  // 1. Check DB/cache for existing data
  // 2. If missing, fetch from 5paisa historical API or NSE
  // 3. Store in DB for future use
  throw new Error("Not implemented — Phase 7");
}

export async function loadHistoricalOptionsChain(
  symbol: string,
  date: string
): Promise<any> {
  // TODO: Phase 7
  // Load EOD options chain snapshot (OI, IV, volume per strike)
  // Source: NSE bhavcopy or cached data
  throw new Error("Not implemented — Phase 7");
}
