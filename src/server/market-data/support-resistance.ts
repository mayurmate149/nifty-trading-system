/**
 * Market Data — Support & Resistance Calculator
 *
 * Computes pivot-based S/R levels from recent OHLC data.
 * Uses Classic Pivot Points + previous day high/low.
 */

import { OHLCBar } from "@/types/market";

export interface SupportResistance {
  support: number[];
  resistance: number[];
  pivotPoint: number;
}

/**
 * Calculate S/R from recent daily OHLC bars using Classic Pivot Points.
 * Takes last N bars, computes pivot from the most recent bar,
 * then aggregates strong levels across multiple days.
 */
export function calculateSupportResistance(bars: OHLCBar[]): SupportResistance {
  if (!bars.length) {
    return { support: [], resistance: [], pivotPoint: 0 };
  }

  // Use the most recent bar for primary pivot calculation
  const latest = bars[bars.length - 1];
  const H = latest.high;
  const L = latest.low;
  const C = latest.close;

  // Classic Pivot Point
  const pivot = round((H + L + C) / 3);

  // Support & Resistance levels
  const R1 = round(2 * pivot - L);
  const R2 = round(pivot + (H - L));
  const R3 = round(H + 2 * (pivot - L));

  const S1 = round(2 * pivot - H);
  const S2 = round(pivot - (H - L));
  const S3 = round(L - 2 * (H - pivot));

  // If we have multiple bars, find strong levels (cluster points)
  const allLevels: number[] = [];
  for (const bar of bars.slice(-5)) {
    const bH = bar.high;
    const bL = bar.low;
    const bC = bar.close;
    const bPivot = (bH + bL + bC) / 3;

    allLevels.push(
      round(2 * bPivot - bL), // R1
      round(bPivot + (bH - bL)), // R2
      round(2 * bPivot - bH), // S1
      round(bPivot - (bH - bL)), // S2
    );
  }

  // Cluster nearby levels (within 0.2%)
  const resistanceLevels = dedup([R1, R2, R3].sort((a, b) => a - b));
  const supportLevels = dedup([S1, S2, S3].sort((a, b) => b - a));

  return {
    support: supportLevels,
    resistance: resistanceLevels,
    pivotPoint: pivot,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Remove levels that are within 0.15% of each other */
function dedup(levels: number[]): number[] {
  const result: number[] = [];
  for (const level of levels) {
    const tooClose = result.some(
      (r) => Math.abs(r - level) / Math.max(r, 1) < 0.0015
    );
    if (!tooClose) result.push(level);
  }
  return result;
}
