/**
 * Analytics Service
 *
 * Phase 4: Computes portfolio analytics, Greeks exposure,
 * P&L charts, payoff diagrams, and IV analysis.
 */

import { Position } from "@/types/position";
import {
  PortfolioSummary,
  GreeksExposure,
  PnLDataPoint,
  PayoffPoint,
  IVSkewPoint,
  OptionChainStrike,
  MarketSnapshot,
} from "@/types/market";

// ─── P&L History (in-memory ring buffer) ─────

interface PnLHistoryEntry {
  time: string;
  pnl: number;
  spot: number;
}

const g = globalThis as any;
if (!g.__pnlHistory) g.__pnlHistory = [] as PnLHistoryEntry[];

const MAX_PNL_HISTORY = 500;

/**
 * Record a P&L snapshot — called periodically by a background tick
 */
export function recordPnLSnapshot(pnl: number, spot: number): void {
  const entry: PnLHistoryEntry = {
    time: new Date().toISOString(),
    pnl: Math.round(pnl * 100) / 100,
    spot: Math.round(spot * 100) / 100,
  };
  g.__pnlHistory.push(entry);
  if (g.__pnlHistory.length > MAX_PNL_HISTORY) {
    g.__pnlHistory.shift();
  }
}

/**
 * Get P&L history for charting
 */
export function getPnLHistory(): PnLDataPoint[] {
  return [...g.__pnlHistory];
}

// ─── Portfolio Summary ───────────────────────

export function computePortfolioSummary(
  positions: Position[],
  snapshot?: MarketSnapshot | null
): PortfolioSummary {
  const open = positions.filter((p) => p.status === "OPEN");
  const positionCapital = open.reduce((sum, p) => sum + p.capitalDeployed, 0);
  const totalPnl = open.reduce((sum, p) => sum + p.pl, 0);

  const marginUsed = snapshot?.margin?.UsedMargin ?? 0;
  const marginAvail = snapshot?.margin?.AvailableMargin ?? 0;
  const marginNet = snapshot?.margin?.NetMargin ?? (marginUsed + marginAvail);

  // Use broker margin as actual capital (correct for option selling/spreads)
  // Fall back to sum of per-position capital if margin not available
  const totalCapital = marginUsed > 0 ? marginUsed : positionCapital;
  const totalPnlPct = totalCapital > 0 ? (totalPnl / totalCapital) * 100 : 0;

  // Day high/low from P&L history
  const history = getPnLHistory();
  const todayStr = new Date().toISOString().split("T")[0];
  const todayHistory = history.filter((h) => h.time.startsWith(todayStr));
  const dayHigh = todayHistory.length > 0 ? Math.max(...todayHistory.map((h) => h.pnl)) : totalPnl;
  const dayLow = todayHistory.length > 0 ? Math.min(...todayHistory.map((h) => h.pnl)) : totalPnl;

  return {
    totalCapitalDeployed: round(totalCapital),
    totalPnl: round(totalPnl),
    totalPnlPct: round(totalPnlPct),
    marginUsed: round(marginUsed),
    marginAvailable: round(marginAvail),
    marginUtilization: marginNet > 0 ? round((marginUsed / marginNet) * 100) : 0,
    positionsCount: positions.length,
    openPositions: open.length,
    dayHigh: round(dayHigh),
    dayLow: round(dayLow),
  };
}

// ─── Greeks Exposure ─────────────────────────

/**
 * Compute aggregate Greeks from positions + option chain data.
 * For simulator, we estimate Greeks based on position characteristics.
 */
export function computeGreeksExposure(
  positions: Position[],
  chain?: OptionChainStrike[]
): GreeksExposure {
  const open = positions.filter((p) => p.status === "OPEN");
  let totalDelta = 0;
  let totalGamma = 0;
  let totalTheta = 0;
  let totalVega = 0;

  const perPosition = open.map((pos) => {
    // Try to find this position's Greeks from the option chain
    let delta = 0, gamma = 0, theta = 0, vega = 0;

    if (chain) {
      const row = chain.find((c) => c.strike === pos.strike);
      if (row) {
        const side = pos.optionType === "CALL" ? row.ce : row.pe;
        delta = side.greeks?.delta || 0;
        gamma = side.greeks?.gamma || 0;
        theta = side.greeks?.theta || 0;
        vega = side.greeks?.vega || 0;
      }
    }

    // If no chain data, estimate Greeks
    if (delta === 0 && gamma === 0) {
      const estimate = estimateGreeks(pos);
      delta = estimate.delta;
      gamma = estimate.gamma;
      theta = estimate.theta;
      vega = estimate.vega;
    }

    // Scale by quantity (negative qty for short positions)
    const qty = pos.quantity;
    const scaledDelta = delta * qty;
    const scaledGamma = gamma * Math.abs(qty);
    const scaledTheta = theta * Math.abs(qty);
    const scaledVega = vega * Math.abs(qty);

    totalDelta += scaledDelta;
    totalGamma += scaledGamma;
    totalTheta += scaledTheta;
    totalVega += scaledVega;

    return {
      positionId: pos.positionId,
      symbol: pos.symbol,
      quantity: qty,
      delta: round(scaledDelta),
      gamma: round(scaledGamma),
      theta: round(scaledTheta),
      vega: round(scaledVega),
    };
  });

  return {
    totalDelta: round(totalDelta),
    totalGamma: round(totalGamma),
    totalTheta: round(totalTheta),
    totalVega: round(totalVega),
    perPosition,
  };
}

/**
 * Rough Greek estimates when chain data is unavailable
 */
function estimateGreeks(pos: Position) {
  const isCall = pos.optionType === "CALL";
  const moneyness = pos.ltp > 0 ? (isCall ? 0.5 : -0.5) : 0;

  return {
    delta: isCall ? 0.5 + moneyness * 0.3 : -0.5 + moneyness * 0.3,
    gamma: 0.005,
    theta: -pos.ltp * 0.02,
    vega: pos.ltp * 0.15,
  };
}

// ─── Payoff Diagram ──────────────────────────

/**
 * Compute payoff at expiry for all positions across a range of spot prices.
 */
export function computePayoffDiagram(
  positions: Position[],
  spot: number,
  rangePercent: number = 5
): PayoffPoint[] {
  const open = positions.filter((p) => p.status === "OPEN");
  if (open.length === 0) return [];

  const low = spot * (1 - rangePercent / 100);
  const high = spot * (1 + rangePercent / 100);
  const step = (high - low) / 100;

  const points: PayoffPoint[] = [];

  for (let s = low; s <= high; s += step) {
    let totalPayoff = 0;

    for (const pos of open) {
      const intrinsic =
        pos.optionType === "CALL"
          ? Math.max(0, s - pos.strike)
          : Math.max(0, pos.strike - s);

      // Payoff = (intrinsic - premium_paid) * quantity
      // For shorts (qty < 0): seller collects premium, pays intrinsic
      const payoffPerLot = intrinsic - pos.avgPrice;
      totalPayoff += payoffPerLot * pos.quantity;
    }

    points.push({
      spot: round(s),
      payoff: round(totalPayoff),
    });
  }

  return points;
}

// ─── IV Skew Analysis ────────────────────────

/**
 * Extract IV skew from option chain for charting
 */
export function computeIVSkew(chain: OptionChainStrike[]): IVSkewPoint[] {
  return chain.map((row) => ({
    strike: row.strike,
    callIV: row.ce.iv,
    putIV: row.pe.iv,
  }));
}

// ─── IV Percentile ───────────────────────────

/**
 * Compute IV percentile: % of days in the past year when IV was lower than current.
 * For simulator, we approximate with VIX.
 */
export function computeIVPercentile(currentIV: number): number {
  // Simplified: use a rough distribution of India VIX
  // Historical range: ~10 to ~40, median ~15
  // This is a rough sigmoid approximation
  const normalized = (currentIV - 10) / 30; // 0-1 range for VIX 10-40
  const percentile = Math.max(0, Math.min(100, Math.round(normalized * 100)));
  return percentile;
}

// ─── Background P&L Ticker ───────────────────

/**
 * Start a background interval that records P&L snapshots.
 * Runs every 5 seconds when positions are active.
 */
export function startPnLRecorder(): void {
  if (g.__pnlRecorderInterval) return; // already running

  g.__pnlRecorderInterval = setInterval(async () => {
    try {
      // Fetch snapshot from simulator
      const USE_SIMULATOR = process.env.USE_SIMULATOR === "true";
      if (!USE_SIMULATOR) return;

      const SIMULATOR_URL = process.env.SIMULATOR_URL || "http://localhost:9500";
      const res = await fetch(`${SIMULATOR_URL}/VendorsAPI/Service1.svc/snapshot`);
      if (!res.ok) return;

      const snapshot: MarketSnapshot = await res.json();
      recordPnLSnapshot(snapshot.totalPnL, snapshot.nifty);
    } catch {
      // Silently fail — simulator might not be running
    }
  }, 5000);

  console.log("[ANALYTICS] P&L recorder started (5s interval)");
}

export function stopPnLRecorder(): void {
  if (g.__pnlRecorderInterval) {
    clearInterval(g.__pnlRecorderInterval);
    g.__pnlRecorderInterval = null;
    console.log("[ANALYTICS] P&L recorder stopped");
  }
}

// ─── Utility ─────────────────────────────────

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
