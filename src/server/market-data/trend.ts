/**
 * Market Data — Trend Classifier
 *
 * Detects market trend using VWAP and moving averages.
 * Returns: "trend-up" | "trend-down" | "range-bound" + strength (0-100)
 */

import { OHLCBar } from "@/types/market";

export type TrendLabel = "trend-up" | "trend-down" | "range-bound";

export interface TrendResult {
  trend: TrendLabel;
  strength: number; // 0-100
  vwap: number;
  sma20: number;
}

/**
 * Calculate VWAP from intraday bars
 */
function calcVWAP(bars: OHLCBar[]): number {
  if (!bars.length) return 0;

  let cumulativeTPV = 0;
  let cumulativeVolume = 0;

  for (const bar of bars) {
    const typicalPrice = (bar.high + bar.low + bar.close) / 3;
    cumulativeTPV += typicalPrice * bar.volume;
    cumulativeVolume += bar.volume;
  }

  return cumulativeVolume > 0 ? cumulativeTPV / cumulativeVolume : bars[bars.length - 1].close;
}

/**
 * Calculate Simple Moving Average of close prices
 */
function calcSMA(bars: OHLCBar[], period: number): number {
  if (bars.length < period) {
    // Use all available bars
    const closes = bars.map((b) => b.close);
    return closes.reduce((a, b) => a + b, 0) / closes.length;
  }

  const recent = bars.slice(-period);
  return recent.reduce((sum, b) => sum + b.close, 0) / period;
}

/**
 * Classify trend from OHLC bars and current spot price.
 * Uses VWAP + SMA20 confluence for confirmation.
 */
export function classifyTrend(
  bars: OHLCBar[],
  currentSpot: number
): TrendResult {
  if (bars.length < 3) {
    return { trend: "range-bound", strength: 0, vwap: currentSpot, sma20: currentSpot };
  }

  const vwap = calcVWAP(bars);
  const sma20 = calcSMA(bars, 20);

  const aboveVWAP = currentSpot > vwap;
  const aboveSMA = currentSpot > sma20;

  // Check if recent bars are making higher highs/lows or lower highs/lows
  const recentBars = bars.slice(-5);
  let higherHighs = 0;
  let lowerLows = 0;
  for (let i = 1; i < recentBars.length; i++) {
    if (recentBars[i].high > recentBars[i - 1].high) higherHighs++;
    if (recentBars[i].low < recentBars[i - 1].low) lowerLows++;
  }

  let trend: TrendLabel;
  let strength: number;

  if (aboveVWAP && aboveSMA) {
    trend = "trend-up";
    // Strength based on how far above and price action
    const distPct = ((currentSpot - vwap) / vwap) * 100;
    strength = Math.min(100, Math.round(40 + distPct * 20 + higherHighs * 10));
  } else if (!aboveVWAP && !aboveSMA) {
    trend = "trend-down";
    const distPct = ((vwap - currentSpot) / vwap) * 100;
    strength = Math.min(100, Math.round(40 + distPct * 20 + lowerLows * 10));
  } else {
    trend = "range-bound";
    strength = Math.max(10, 50 - Math.abs(higherHighs - lowerLows) * 10);
  }

  return { trend, strength: Math.max(0, Math.min(100, strength)), vwap, sma20 };
}
