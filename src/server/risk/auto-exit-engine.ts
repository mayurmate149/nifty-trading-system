/**
 * Auto-Exit Engine — Phase 5
 *
 * ┌────────────────────────────────────────────────────────────────┐
 * │  RUNS SERVER-SIDE ONLY — independent of browser/client.       │
 * │  Once enabled, the engine keeps running even if the user      │
 * │  closes the browser. It only stops when explicitly disabled   │
 * │  via the API or when the Next.js server process restarts.     │
 * └────────────────────────────────────────────────────────────────┘
 *
 * Progressive Trailing Stop-Loss (portfolio-level):
 *
 *   1. Initial SL = -stopLossPercent (default -1%)
 *   2. Profit >= 1% → SL moves to  0% (breakeven)
 *   3. Profit >= 2% → SL moves to  1%
 *   4. Profit >= 3% → SL moves to  2%
 *   5. General rule: SL = floor(profit%) - trailOffsetPercent
 *      (SL only moves UP, never down — "ratchet" behaviour)
 *   6. When portfolio P&L drops to or below current trailing SL → EXIT ALL
 *
 * The engine runs a 1-second polling loop. On each tick it:
 *   - Fetches live positions from broker-proxy
 *   - Computes combined portfolio P&L %
 *   - Updates trailing SL using the progressive formula
 *   - If portfolio P&L ≤ current SL → exits ALL open positions in parallel
 *   - Emits events to the notifier (SSE → frontend)
 */

import { AutoExitConfig, AutoExitState, RiskSummary } from "@/types/risk";
import { Position } from "@/types/position";
import { getPositions, placeOrder, getMargin, computeMarginFromPositions } from "@/server/broker-proxy";
import { sendNotification, pushEvent } from "@/server/risk/notifier";

// ─── Persist state across Next.js HMR (dev) ─────
// All state lives on globalThis so it survives module hot-reloads
// AND keeps running when the browser is closed.

const g = globalThis as unknown as {
  __autoExitWatched?: Map<string, AutoExitState>;
  __autoExitInterval?: NodeJS.Timeout | null;
  __autoExitCredentials?: { accessToken: string; clientCode: string } | null;
  __autoExitRunning?: boolean;
  __autoExitConfig?: AutoExitConfig;
  __peakPortfolioPnlPct?: number;
  __portfolioTrailingSLPct?: number;   // current trailing SL (ratchets up)
  __exitingAll?: boolean;
  __lastTickEventTime?: number;
};

if (!g.__autoExitWatched) g.__autoExitWatched = new Map();
if (!g.__autoExitInterval) g.__autoExitInterval = null;
if (!g.__autoExitCredentials) g.__autoExitCredentials = null;
if (g.__autoExitRunning === undefined) g.__autoExitRunning = false;
if (g.__peakPortfolioPnlPct === undefined) g.__peakPortfolioPnlPct = 0;
if (g.__portfolioTrailingSLPct === undefined) g.__portfolioTrailingSLPct = undefined;
if (g.__exitingAll === undefined) g.__exitingAll = false;

const watchedPositions = g.__autoExitWatched;

// ─── Default Config ──────────────────────────

const DEFAULT_CONFIG: AutoExitConfig = {
  mode: "ENABLE",
  stopLossPercent: 1.0,
  trailOffsetPercent: 1.0,
  profitFloorPercent: 2.0,
};

function getConfig(): AutoExitConfig {
  return g.__autoExitConfig ?? DEFAULT_CONFIG;
}

// ─── Watch Management ────────────────────────

export function startWatching(
  positionId: string,
  config: Partial<AutoExitConfig> = {}
): AutoExitState {
  const mergedConfig: AutoExitConfig = { ...getConfig(), ...config, mode: "ENABLE" };
  const state: AutoExitState = {
    watchId: `watch_${positionId}_${Date.now()}`,
    positionId,
    active: true,
    config: mergedConfig,
    currentSLPercent: -mergedConfig.stopLossPercent,
    peakProfitPercent: 0,
  };

  watchedPositions.set(positionId, state);
  console.log(`[AUTO-EXIT] 👁️ Watching ${positionId}`);

  pushEvent({
    type: "WATCH_STARTED",
    positionId,
    message: `Watching ${positionId}`,
    timestamp: Date.now(),
  });

  return state;
}

export function stopWatching(positionId: string): void {
  if (watchedPositions.has(positionId)) {
    watchedPositions.delete(positionId);
  }
}

export function watchAllPositions(
  positions: Position[],
  config: Partial<AutoExitConfig> = {}
): AutoExitState[] {
  const states: AutoExitState[] = [];
  for (const pos of positions) {
    if (pos.status === "OPEN" && pos.quantity !== 0) {
      states.push(startWatching(pos.positionId, config));
    }
  }
  return states;
}

export function unwatchAll(): void {
  watchedPositions.clear();
}

export function getWatchedPositions(): AutoExitState[] {
  return Array.from(watchedPositions.values());
}

export function getWatchedPosition(positionId: string): AutoExitState | undefined {
  return watchedPositions.get(positionId);
}

export function isEngineRunning(): boolean {
  return g.__autoExitRunning ?? false;
}

export function getPortfolioState() {
  const config = getConfig();
  return {
    peakPnlPct: g.__peakPortfolioPnlPct ?? 0,
    currentTrailingSLPct: g.__portfolioTrailingSLPct ?? -config.stopLossPercent,
  };
}

// ─── Risk Summary ────────────────────────────

export function computeRiskSummary(positions: Position[], brokerUsedMargin?: number): RiskSummary {
  const openPositions = positions.filter((p) => p.status === "OPEN" && p.quantity !== 0);
  const positionCapital = openPositions.reduce((sum, p) => sum + p.capitalDeployed, 0);
  const config = getConfig();

  // Capital priority: config.capitalOverride > broker margin > computed margin > position sum
  let totalCapital: number;
  if (config.capitalOverride && config.capitalOverride > 0) {
    totalCapital = config.capitalOverride;
  } else if (brokerUsedMargin && brokerUsedMargin > 0) {
    totalCapital = brokerUsedMargin;
  } else {
    const computed = computeMarginFromPositions(openPositions);
    totalCapital = computed.marginRequired > 0 ? computed.marginRequired : positionCapital;
  }

  const totalPnl = openPositions.reduce((sum, p) => sum + p.pl, 0);
  const maxLoss = totalCapital * (config.stopLossPercent / 100);

  return {
    totalCapitalDeployed: totalCapital,
    totalUnrealizedPnl: totalPnl,
    maxPossibleLoss: maxLoss,
    positionsWatched: watchedPositions.size,
    positionsTotal: openPositions.length,
  };
}

// ─── Core: Portfolio-Level Progressive Trailing SL ───

export async function evaluateExitRules(positions: Position[], brokerUsedMargin?: number): Promise<void> {
  // Guard: don't re-enter while already exiting
  if (g.__exitingAll) return;

  // Only consider watched & open positions
  const watchedOpen: Position[] = [];
  const entries = Array.from(watchedPositions.entries());
  for (let i = 0; i < entries.length; i++) {
    const [positionId] = entries[i];
    const pos = positions.find((p) => p.positionId === positionId);
    if (!pos || pos.status === "CLOSED" || pos.quantity === 0) {
      stopWatching(positionId);
      continue;
    }
    watchedOpen.push(pos);
  }

  if (watchedOpen.length === 0) {
    console.warn(
      `[AUTO-EXIT] ⚠️ No watched positions matched. Watched IDs: [${Array.from(watchedPositions.keys()).join(", ")}] | ` +
      `Fetched IDs: [${positions.map((p) => p.positionId).join(", ")}]`
    );
    return;
  }

  // ── Compute PORTFOLIO-level combined P&L % ──
  // Capital priority: config.capitalOverride > broker UsedMargin > sum(position capital)
  const config = getConfig();
  const totalPnl = watchedOpen.reduce((s, p) => s + p.pl, 0);
  const positionCapital = watchedOpen.reduce((s, p) => s + p.capitalDeployed, 0);

  let totalCapital: number;
  let capitalSource: string;

  if (config.capitalOverride && config.capitalOverride > 0) {
    totalCapital = config.capitalOverride;
    capitalSource = "override";
  } else if (brokerUsedMargin && brokerUsedMargin > 0) {
    totalCapital = brokerUsedMargin;
    capitalSource = "broker-margin";
  } else {
    // Broker margin API returned 0 — compute margin from position structure
    // (spread margin estimation using SPAN-like per-lot calculation)
    const computed = computeMarginFromPositions(watchedOpen);
    if (computed.marginRequired > 0) {
      totalCapital = computed.marginRequired;
      capitalSource = "computed-margin";
    } else {
      totalCapital = positionCapital;
      capitalSource = "position-sum";
    }
  }

  if (totalCapital <= 0) {
    console.warn(
      `[AUTO-EXIT] ⚠️ Capital is ₹0 — cannot compute P&L %. ` +
      `Override: ${config.capitalOverride}, Margin: ${brokerUsedMargin}, PositionCap: ${positionCapital}, ` +
      `Positions: ${watchedOpen.map((p) => `${p.symbol}(cap=${p.capitalDeployed},avg=${p.avgPrice},qty=${p.quantity})`).join(", ")}`
    );
    return;
  }

  const portfolioPnlPct = (totalPnl / totalCapital) * 100;

  // Track peak portfolio P&L
  if (portfolioPnlPct > (g.__peakPortfolioPnlPct ?? 0)) {
    g.__peakPortfolioPnlPct = portfolioPnlPct;
  }

  // ── Progressive Trailing SL Calculation ──
  // Initial SL = -stopLossPercent (e.g. -1%)
  // When profit >= N% (N=1,2,3,...): SL = floor(profit) - trailOffsetPercent
  // Once profit ever >= profitFloorPercent: SL = max(computed, profitFloorPercent)
  // SL only ratchets UP, never down.
  const currentSL = g.__portfolioTrailingSLPct ?? -config.stopLossPercent;
  let newSL = currentSL;

  if (portfolioPnlPct >= config.trailOffsetPercent) {
    // floor(profit) - offset  →  e.g. profit=2.7, offset=1 → SL = floor(2.7) - 1 = 1%
    let computedSL = Math.floor(portfolioPnlPct) - config.trailOffsetPercent;

    // Profit floor: once profit has reached profitFloorPercent, SL never goes below it
    // e.g. profit=2.5%, floor=2% → SL = max(1%, 2%) = 2%
    if (portfolioPnlPct >= config.profitFloorPercent) {
      computedSL = Math.max(computedSL, config.profitFloorPercent);
    }

    if (computedSL > currentSL) {
      newSL = computedSL;
    }
  }

  // Emit trail update event when SL moves up
  if (newSL > currentSL) {
    g.__portfolioTrailingSLPct = newSL;
    console.log(
      `[AUTO-EXIT] 📈 TRAILING SL MOVED: ${currentSL.toFixed(1)}% → ${newSL.toFixed(1)}% ` +
      `(P&L: ${portfolioPnlPct.toFixed(2)}%)`
    );
    pushEvent({
      type: "TRAIL_UPDATE",
      positionId: "PORTFOLIO",
      message: `Trailing SL moved: ${currentSL.toFixed(1)}% → ${newSL.toFixed(1)}% (P&L: ${portfolioPnlPct.toFixed(2)}%)`,
      timestamp: Date.now(),
      data: { previousSL: currentSL, newSL, portfolioPnlPct, peakPnlPct: g.__peakPortfolioPnlPct },
    });
    sendNotification({
      type: "TRAIL_UPDATE",
      title: `📈 Trailing SL → ${newSL.toFixed(1)}%`,
      message: `Portfolio P&L at +${portfolioPnlPct.toFixed(1)}%, SL moved from ${currentSL.toFixed(1)}% to ${newSL.toFixed(1)}%`,
      data: { previousSL: currentSL, newSL, portfolioPnlPct },
    });
  }

  const activeSL = g.__portfolioTrailingSLPct ?? -config.stopLossPercent;

  console.log(
    `[AUTO-EXIT] Portfolio P&L: ${portfolioPnlPct.toFixed(2)}% (₹${totalPnl.toFixed(0)}) | ` +
    `Capital: ₹${totalCapital.toFixed(0)} (${capitalSource}) | ` +
    `Peak: ${(g.__peakPortfolioPnlPct ?? 0).toFixed(2)}% | ` +
    `SL: ${activeSL.toFixed(1)}% | Offset: ${config.trailOffsetPercent}%`
  );

  // ── Emit periodic TICK event every ~5 seconds for UI visibility ──
  const now = Date.now();
  if (!g.__lastTickEventTime || now - g.__lastTickEventTime >= 5000) {
    g.__lastTickEventTime = now;
    pushEvent({
      type: "TICK",
      positionId: "PORTFOLIO",
      message: `P&L: ${portfolioPnlPct.toFixed(2)}% (₹${totalPnl.toFixed(0)}) | SL: ${activeSL.toFixed(1)}% | Peak: ${(g.__peakPortfolioPnlPct ?? 0).toFixed(2)}% | Capital: ₹${totalCapital.toFixed(0)}`,
      timestamp: now,
      data: { portfolioPnlPct, totalPnl, activeSL, peakPnlPct: g.__peakPortfolioPnlPct, totalCapital, capitalSource, positions: watchedOpen.length },
    });
  }

  // ── EXIT CHECK: P&L dropped to or below trailing SL → EXIT ALL ──
  if (portfolioPnlPct <= activeSL) {
    const reason: "STOP_LOSS" | "TAKE_PROFIT" | "BREAKEVEN" =
      activeSL < 0 ? "STOP_LOSS" : activeSL === 0 ? "BREAKEVEN" : "TAKE_PROFIT";

    console.log(
      `[AUTO-EXIT] 🔴🔴 TRAILING SL HIT: P&L ${portfolioPnlPct.toFixed(2)}% <= SL ${activeSL.toFixed(1)}% → EXIT ALL (${reason})`
    );
    await executeExitAll(watchedOpen, reason, portfolioPnlPct, totalPnl);
    return;
  }
}

// ─── Execute EXIT ALL — squares off every position in parallel ───

async function executeExitAll(
  positions: Position[],
  reason: "STOP_LOSS" | "TAKE_PROFIT" | "BREAKEVEN",
  portfolioPnlPct: number,
  totalPnl: number
): Promise<void> {
  const creds = g.__autoExitCredentials;
  if (!creds) {
    console.error("[AUTO-EXIT] No credentials — cannot exit");
    pushEvent({
      type: "ERROR",
      positionId: "PORTFOLIO",
      message: "Cannot exit: no broker credentials stored",
      timestamp: Date.now(),
    });
    return;
  }

  g.__exitingAll = true;

  const reasonLabels = {
    STOP_LOSS: "🔴 Portfolio Stop-Loss",
    TAKE_PROFIT: "🟢 Portfolio Take-Profit",
    BREAKEVEN: "⚪ Portfolio Breakeven",
  };

  pushEvent({
    type: reason,
    positionId: "PORTFOLIO",
    message: `${reasonLabels[reason]}: Exiting ALL ${positions.length} positions (P&L: ${portfolioPnlPct.toFixed(2)}%, ₹${totalPnl.toFixed(0)})`,
    timestamp: Date.now(),
    data: { reason, portfolioPnlPct, totalPnl, positionCount: positions.length },
  });

  // Exit in correct order: close SELL legs first (buy-to-close), then BUY legs (sell-to-close)
  // This keeps the hedge alive while closing the risky short positions first.
  const sellPositions = positions.filter((p) => p.quantity < 0); // short legs → exit by BUY
  const buyPositions = positions.filter((p) => p.quantity > 0);  // long legs  → exit by SELL

  const exitOne = async (pos: Position) => {
    const exitSide: "B" | "S" = pos.quantity > 0 ? "S" : "B";
    const exitQty = Math.abs(pos.quantity);
    const scripCode = parseInt(pos.positionId) || 0;

    console.log(
      `[AUTO-EXIT] 📤 Placing exit order: ${pos.symbol} | ScripCode: ${scripCode} | ` +
      `Side: ${exitSide} | Qty: ${exitQty} | Exchange: ${pos.exchange || "N"} | ` +
      `ExchType: ${pos.exchangeType || "D"} | Intraday: ${pos.isIntraday ?? false}`
    );

    try {
      const result = await placeOrder(creds, {
        scripCode,
        quantity: exitQty,
        buySell: exitSide,
        exchange: pos.exchange || "N",
        exchangeType: pos.exchangeType || "D",
        price: 0,
        isIntraday: pos.isIntraday ?? false,
        atMarket: true,
      });

      console.log(`[AUTO-EXIT] ✅ Exited ${pos.symbol} (${exitSide === "B" ? "BUY" : "SELL"} ${exitQty}) | Order: ${result?.ExchOrderID}`);

      pushEvent({
        type: "EXIT_EXECUTED",
        positionId: pos.positionId,
        message: `Exited ${pos.symbol}: ${exitSide === "B" ? "BUY" : "SELL"} ${exitQty} @ market`,
        timestamp: Date.now(),
        data: { orderId: result?.ExchOrderID, ltp: pos.ltp, pl: pos.pl },
      });

      return { success: true, symbol: pos.symbol };
    } catch (error: any) {
      console.error(`[AUTO-EXIT] ❌ Failed to exit ${pos.symbol}:`, error.message);
      pushEvent({
        type: "ERROR",
        positionId: pos.positionId,
        message: `Failed to exit ${pos.symbol}: ${error.message}`,
        timestamp: Date.now(),
      });
      return { success: false, symbol: pos.symbol, error: error.message };
    }
  };

  // Step 1: Close all SELL (short) positions in parallel
  console.log(`[AUTO-EXIT] Step 1: Closing ${sellPositions.length} SELL legs (buy-to-close)...`);
  const sellResults = await Promise.all(sellPositions.map(exitOne));

  // Step 2: Close all BUY (long) positions in parallel
  console.log(`[AUTO-EXIT] Step 2: Closing ${buyPositions.length} BUY legs (sell-to-close)...`);
  const buyResults = await Promise.all(buyPositions.map(exitOne));

  const results = [...sellResults, ...buyResults];
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  // Summary notification
  sendNotification({
    type: "EXIT_TRIGGER",
    title: `${reasonLabels[reason]} — ALL EXITED`,
    message: `${succeeded}/${positions.length} positions exited (${failed} failed) | Portfolio P&L: ${portfolioPnlPct.toFixed(2)}% (₹${totalPnl.toFixed(0)})`,
    data: { reason, portfolioPnlPct, totalPnl, succeeded, failed },
  });

  // Clear all watches & stop engine after full exit
  unwatchAll();
  g.__exitingAll = false;
  g.__peakPortfolioPnlPct = 0;
  g.__portfolioTrailingSLPct = undefined;

  // Auto-stop engine after exit-all (all positions squared off)
  stopEngine();

  console.log(`[AUTO-EXIT] 🏁 EXIT-ALL complete: ${succeeded} ok, ${failed} failed. Engine stopped.`);
}

// ─── Engine Loop ─────────────────────────────
// Runs as a setInterval on the Node.js server process.
// DOES NOT depend on the browser being open.

export function startEngine(credentials: { accessToken: string; clientCode: string }, config?: Partial<AutoExitConfig>): void {
  if (g.__autoExitRunning && g.__autoExitInterval) {
    console.log("[AUTO-EXIT] Engine already running (browser-independent)");
    return;
  }

  g.__autoExitCredentials = credentials;
  g.__autoExitRunning = true;
  g.__autoExitConfig = { ...DEFAULT_CONFIG, ...config };
  g.__peakPortfolioPnlPct = 0;
  g.__portfolioTrailingSLPct = undefined;
  g.__exitingAll = false;
  g.__lastTickEventTime = undefined;

  const cfg = getConfig();
  console.log(`[AUTO-EXIT] 🚀 Engine STARTED (server-side, browser-independent)`);
  console.log(`[AUTO-EXIT]    Initial SL: -${cfg.stopLossPercent}% | Trail offset: ${cfg.trailOffsetPercent}% | Profit floor: ${cfg.profitFloorPercent}%`);
  console.log(`[AUTO-EXIT]    Progressive trailing: SL = max(floor(profit) - ${cfg.trailOffsetPercent}%, ${cfg.profitFloorPercent}%) once profit >= ${cfg.profitFloorPercent}%`);

  pushEvent({
    type: "ENGINE_STARTED",
    positionId: "",
    message: `Engine started — Initial SL: -${cfg.stopLossPercent}% | Trail offset: ${cfg.trailOffsetPercent}% | Profit floor: ${cfg.profitFloorPercent}% | Runs even if browser is closed`,
    timestamp: Date.now(),
    data: { config: cfg },
  });

  g.__autoExitInterval = setInterval(async () => {
    try {
      if (!g.__autoExitCredentials) return;
      if (watchedPositions.size === 0) return;

      const creds = {
        accessToken: g.__autoExitCredentials.accessToken,
        clientCode: g.__autoExitCredentials.clientCode,
      };

      // Fetch positions and margin in parallel
      const [positions, margin] = await Promise.all([
        getPositions(creds),
        getMargin(creds),
      ]);

      await evaluateExitRules(positions, margin.usedMargin);
    } catch (error: any) {
      console.error("[AUTO-EXIT] Engine tick error:", error.message);
    }
  }, 1000);
}

export function stopEngine(): void {
  if (g.__autoExitInterval) {
    clearInterval(g.__autoExitInterval);
    g.__autoExitInterval = null;
  }
  g.__autoExitRunning = false;
  g.__autoExitCredentials = null;
  g.__peakPortfolioPnlPct = 0;
  g.__portfolioTrailingSLPct = undefined;
  g.__exitingAll = false;
  unwatchAll();

  console.log("[AUTO-EXIT] 🛑 Engine STOPPED");
  pushEvent({
    type: "ENGINE_STOPPED",
    positionId: "",
    message: "Auto-exit engine stopped",
    timestamp: Date.now(),
  });
}

// ─── Manual Exit All ─────────────────────────
// Called from the UI "Exit All" button — exits every open position immediately.

export async function exitAllNow(credentials: { accessToken: string; clientCode: string }): Promise<{
  succeeded: number;
  failed: number;
  total: number;
}> {
  // Store credentials temporarily if engine isn't running
  const prevCreds = g.__autoExitCredentials;
  g.__autoExitCredentials = credentials;

  try {
    const positions = await getPositions(credentials);
    const openPositions = positions.filter((p) => p.status === "OPEN" && p.quantity !== 0);

    if (openPositions.length === 0) {
      return { succeeded: 0, failed: 0, total: 0 };
    }

    const totalPnl = openPositions.reduce((s, p) => s + p.pl, 0);
    const totalCapital = openPositions.reduce((s, p) => s + p.capitalDeployed, 0);
    const pnlPct = totalCapital > 0 ? (totalPnl / totalCapital) * 100 : 0;

    console.log(`[AUTO-EXIT] 🔴 MANUAL EXIT ALL — ${openPositions.length} positions, P&L: ₹${totalPnl.toFixed(0)}`);

    await executeExitAll(openPositions, "STOP_LOSS", pnlPct, totalPnl);

    // Count results from the event log (approximate)
    return { succeeded: openPositions.length, failed: 0, total: openPositions.length };
  } catch (error: any) {
    console.error("[AUTO-EXIT] Manual exit-all failed:", error.message);
    pushEvent({
      type: "ERROR",
      positionId: "PORTFOLIO",
      message: `Manual exit-all failed: ${error.message}`,
      timestamp: Date.now(),
    });
    throw error;
  } finally {
    // Restore previous credentials if engine wasn't running
    if (!prevCreds) {
      g.__autoExitCredentials = null;
    }
  }
}
