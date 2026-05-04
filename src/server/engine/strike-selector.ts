/**
 * Strike Selector — picks concrete strikes for each of the 8 rule-based
 * strategies using the live chain.
 *
 *   BULL_CALL_SPREAD   — BUY ATM CE + SELL (ATM+W) CE                 (debit)
 *   BULL_PUT_SPREAD    — SELL (ATM-W) PE + BUY (ATM-W-step*2) PE       (credit)
 *   BEAR_PUT_SPREAD    — BUY ATM PE + SELL (ATM-W) PE                  (debit)
 *   BEAR_CALL_SPREAD   — SELL (ATM+W) CE + BUY (ATM+W+step*2) CE       (credit)
 *   IRON_FLY           — SELL ATM CE+PE + BUY wing CE+PE               (credit, 4-leg)
 *   SHORT_IRON_CONDOR  — SELL OTM CE+PE + BUY further OTM CE+PE        (credit, 4-leg)
 *   DIRECTIONAL_BUY    — BUY ATM / slight-ITM on live trend            (debit, 1-leg)
 *   NAKED_BUY          — BUY OTM on live trend                         (debit, 1-leg)
 */

import { StrategyType, StrategyLeg, TradeDirection } from "@/types/strategy";
import { OptionChainStrike } from "@/types/market";

const NIFTY_LOT = 65;
const NIFTY_STEP = 50;

export interface StrikeSelection {
  legs: StrategyLeg[];
  direction: TradeDirection;
  netPremium: number;      // positive = credit, negative = debit
  maxProfit: number;
  maxLoss: number;
  breakeven: number[];
}

// ─── Main entry ─────────────────────────────────────────────────────────────

export function selectStrikes(
  strategy: StrategyType,
  spot: number,
  chain: OptionChainStrike[],
  trend: string,
  lotSize: number = NIFTY_LOT,
): StrikeSelection[] {
  const atm = Math.round(spot / NIFTY_STEP) * NIFTY_STEP;

  switch (strategy) {
    case "BULL_CALL_SPREAD":
      return selectBullCallSpread(chain, atm, lotSize);
    case "BULL_PUT_SPREAD":
      return selectBullPutSpread(chain, atm, lotSize);
    case "BEAR_PUT_SPREAD":
      return selectBearPutSpread(chain, atm, lotSize);
    case "BEAR_CALL_SPREAD":
      return selectBearCallSpread(chain, atm, lotSize);
    case "IRON_FLY":
      return selectIronFly(chain, atm, lotSize);
    case "SHORT_IRON_CONDOR":
      return selectShortIronCondor(chain, atm, lotSize);
    case "DIRECTIONAL_BUY":
      return selectDirectionalBuy(chain, atm, trend, lotSize);
    case "NAKED_BUY":
      return selectNakedBuy(chain, atm, trend, lotSize);
    default:
      return [];
  }
}

// ─── Bull Call Spread (debit, bullish) ──────────────────────────────────────

function selectBullCallSpread(
  chain: OptionChainStrike[],
  atm: number,
  lotSize: number,
): StrikeSelection[] {
  const results: StrikeSelection[] = [];
  const buyStrike = atm;
  const buy = findStrike(chain, buyStrike);
  if (!buy || buy.ce.ltp <= 0) return results;

  for (const width of [100, 150, 200]) {
    const sellStrike = atm + width;
    const sell = findStrike(chain, sellStrike);
    if (!sell || sell.ce.ltp <= 0) continue;

    const debit = buy.ce.ltp - sell.ce.ltp;
    if (debit <= 0) continue;

    const maxProfit = (width - debit) * lotSize;
    const maxLoss = debit * lotSize;

    results.push({
      direction: "BULLISH",
      legs: [
        makeLeg("BUY_CALL", buyStrike, buy.ce, lotSize),
        makeLeg("SELL_CALL", sellStrike, sell.ce, lotSize),
      ],
      netPremium: r2(-debit),
      maxProfit: r2(maxProfit),
      maxLoss: r2(maxLoss),
      breakeven: [r2(buyStrike + debit)],
    });
  }
  return results;
}

// ─── Bull Put Spread (credit, bullish) ──────────────────────────────────────

function selectBullPutSpread(
  chain: OptionChainStrike[],
  atm: number,
  lotSize: number,
): StrikeSelection[] {
  const results: StrikeSelection[] = [];
  for (const dist of [50, 100, 150, 200]) {
    const sellStrike = atm - dist;
    const buyStrike = sellStrike - NIFTY_STEP * 2;
    const sell = findStrike(chain, sellStrike);
    const buy = findStrike(chain, buyStrike);
    if (!sell || !buy) continue;

    const credit = sell.pe.ltp - buy.pe.ltp;
    if (credit <= 0) continue;

    const width = sellStrike - buyStrike;
    const maxLoss = (width - credit) * lotSize;
    const maxProfit = credit * lotSize;

    results.push({
      direction: "BULLISH",
      legs: [
        makeLeg("SELL_PUT", sellStrike, sell.pe, lotSize),
        makeLeg("BUY_PUT", buyStrike, buy.pe, lotSize),
      ],
      netPremium: r2(credit),
      maxProfit: r2(maxProfit),
      maxLoss: r2(maxLoss),
      breakeven: [r2(sellStrike - credit)],
    });
  }
  return results;
}

// ─── Bear Put Spread (debit, bearish) ───────────────────────────────────────

function selectBearPutSpread(
  chain: OptionChainStrike[],
  atm: number,
  lotSize: number,
): StrikeSelection[] {
  const results: StrikeSelection[] = [];
  const buyStrike = atm;
  const buy = findStrike(chain, buyStrike);
  if (!buy || buy.pe.ltp <= 0) return results;

  for (const width of [100, 150, 200]) {
    const sellStrike = atm - width;
    const sell = findStrike(chain, sellStrike);
    if (!sell || sell.pe.ltp <= 0) continue;

    const debit = buy.pe.ltp - sell.pe.ltp;
    if (debit <= 0) continue;

    const maxProfit = (width - debit) * lotSize;
    const maxLoss = debit * lotSize;

    results.push({
      direction: "BEARISH",
      legs: [
        makeLeg("BUY_PUT", buyStrike, buy.pe, lotSize),
        makeLeg("SELL_PUT", sellStrike, sell.pe, lotSize),
      ],
      netPremium: r2(-debit),
      maxProfit: r2(maxProfit),
      maxLoss: r2(maxLoss),
      breakeven: [r2(buyStrike - debit)],
    });
  }
  return results;
}

// ─── Bear Call Spread (credit, bearish) ─────────────────────────────────────

function selectBearCallSpread(
  chain: OptionChainStrike[],
  atm: number,
  lotSize: number,
): StrikeSelection[] {
  const results: StrikeSelection[] = [];
  for (const dist of [50, 100, 150, 200]) {
    const sellStrike = atm + dist;
    const buyStrike = sellStrike + NIFTY_STEP * 2;
    const sell = findStrike(chain, sellStrike);
    const buy = findStrike(chain, buyStrike);
    if (!sell || !buy) continue;

    const credit = sell.ce.ltp - buy.ce.ltp;
    if (credit <= 0) continue;

    const width = buyStrike - sellStrike;
    const maxLoss = (width - credit) * lotSize;
    const maxProfit = credit * lotSize;

    results.push({
      direction: "BEARISH",
      legs: [
        makeLeg("SELL_CALL", sellStrike, sell.ce, lotSize),
        makeLeg("BUY_CALL", buyStrike, buy.ce, lotSize),
      ],
      netPremium: r2(credit),
      maxProfit: r2(maxProfit),
      maxLoss: r2(maxLoss),
      breakeven: [r2(sellStrike + credit)],
    });
  }
  return results;
}

// ─── Iron Fly (credit, neutral, 4-leg) ──────────────────────────────────────

function selectIronFly(
  chain: OptionChainStrike[],
  atm: number,
  lotSize: number,
): StrikeSelection[] {
  const results: StrikeSelection[] = [];
  const body = findStrike(chain, atm);
  if (!body || body.ce.ltp <= 0 || body.pe.ltp <= 0) return results;

  for (const wing of [100, 150, 200, 250]) {
    const buyCallStrike = atm + wing;
    const buyPutStrike = atm - wing;
    const buyCall = findStrike(chain, buyCallStrike);
    const buyPut = findStrike(chain, buyPutStrike);
    if (!buyCall || !buyPut) continue;

    const bodyCredit = body.ce.ltp + body.pe.ltp;
    const wingDebit = buyCall.ce.ltp + buyPut.pe.ltp;
    const netCredit = bodyCredit - wingDebit;
    if (netCredit <= 2) continue;

    const maxLossPts = wing - netCredit;
    if (maxLossPts <= 0) continue;
    const maxProfit = netCredit * lotSize;
    const maxLoss = maxLossPts * lotSize;

    results.push({
      direction: "NEUTRAL",
      legs: [
        makeLeg("SELL_CALL", atm, body.ce, lotSize),
        makeLeg("BUY_CALL", buyCallStrike, buyCall.ce, lotSize),
        makeLeg("SELL_PUT", atm, body.pe, lotSize),
        makeLeg("BUY_PUT", buyPutStrike, buyPut.pe, lotSize),
      ],
      netPremium: r2(netCredit),
      maxProfit: r2(maxProfit),
      maxLoss: r2(maxLoss),
      breakeven: [r2(atm - netCredit), r2(atm + netCredit)],
    });
  }
  return results;
}

// ─── Short Iron Condor (credit, neutral, 4-leg) ─────────────────────────────

function selectShortIronCondor(
  chain: OptionChainStrike[],
  atm: number,
  lotSize: number,
): StrikeSelection[] {
  const results: StrikeSelection[] = [];
  for (const width of [150, 200, 300]) {
    const sellCallStrike = atm + width;
    const buyCallStrike = sellCallStrike + NIFTY_STEP * 2;
    const sellPutStrike = atm - width;
    const buyPutStrike = sellPutStrike - NIFTY_STEP * 2;

    const sc = findStrike(chain, sellCallStrike);
    const bc = findStrike(chain, buyCallStrike);
    const sp = findStrike(chain, sellPutStrike);
    const bp = findStrike(chain, buyPutStrike);
    if (!sc || !bc || !sp || !bp) continue;

    const netCredit = sc.ce.ltp - bc.ce.ltp + sp.pe.ltp - bp.pe.ltp;
    if (netCredit <= 2) continue;
    const spreadWidth = buyCallStrike - sellCallStrike;
    const maxLoss = (spreadWidth - netCredit) * lotSize;
    const maxProfit = netCredit * lotSize;
    if (maxLoss <= 0 || maxProfit <= 0) continue;

    results.push({
      direction: "NEUTRAL",
      legs: [
        makeLeg("SELL_CALL", sellCallStrike, sc.ce, lotSize),
        makeLeg("BUY_CALL", buyCallStrike, bc.ce, lotSize),
        makeLeg("SELL_PUT", sellPutStrike, sp.pe, lotSize),
        makeLeg("BUY_PUT", buyPutStrike, bp.pe, lotSize),
      ],
      netPremium: r2(netCredit),
      maxProfit: r2(maxProfit),
      maxLoss: r2(maxLoss),
      breakeven: [r2(sellPutStrike - netCredit), r2(sellCallStrike + netCredit)],
    });
  }
  return results;
}

// ─── Directional Buy (1-leg, ATM / slight-ITM) ──────────────────────────────

function selectDirectionalBuy(
  chain: OptionChainStrike[],
  atm: number,
  trend: string,
  lotSize: number,
): StrikeSelection[] {
  const results: StrikeSelection[] = [];
  const offsets = [0, -NIFTY_STEP]; // ATM, slight ITM

  if (trend === "trend-up") {
    for (const offset of offsets) {
      const strike = atm + offset;
      const row = findStrike(chain, strike);
      if (!row || row.ce.ltp <= 0) continue;
      const premium = row.ce.ltp;
      results.push({
        direction: "BULLISH",
        legs: [makeLeg("BUY_CALL", strike, row.ce, lotSize)],
        netPremium: r2(-premium),
        maxProfit: r2(premium * 3 * lotSize), // rough 3× target
        maxLoss: r2(premium * lotSize),
        breakeven: [r2(strike + premium)],
      });
    }
  }

  if (trend === "trend-down") {
    for (const offset of offsets) {
      const strike = atm - offset;
      const row = findStrike(chain, strike);
      if (!row || row.pe.ltp <= 0) continue;
      const premium = row.pe.ltp;
      results.push({
        direction: "BEARISH",
        legs: [makeLeg("BUY_PUT", strike, row.pe, lotSize)],
        netPremium: r2(-premium),
        maxProfit: r2(premium * 3 * lotSize),
        maxLoss: r2(premium * lotSize),
        breakeven: [r2(strike - premium)],
      });
    }
  }
  return results;
}

// ─── Naked Buy (1-leg, OTM lotto) ───────────────────────────────────────────

function selectNakedBuy(
  chain: OptionChainStrike[],
  atm: number,
  trend: string,
  lotSize: number,
): StrikeSelection[] {
  const results: StrikeSelection[] = [];
  const otmOffsets = [NIFTY_STEP, NIFTY_STEP * 2]; // 1, 2 strikes OTM

  if (trend === "trend-up") {
    for (const off of otmOffsets) {
      const strike = atm + off;
      const row = findStrike(chain, strike);
      if (!row || row.ce.ltp <= 1) continue;
      const premium = row.ce.ltp;
      results.push({
        direction: "BULLISH",
        legs: [makeLeg("BUY_CALL", strike, row.ce, lotSize)],
        netPremium: r2(-premium),
        maxProfit: r2(premium * 4 * lotSize), // pure-OTM has larger R but lower P(win)
        maxLoss: r2(premium * lotSize),
        breakeven: [r2(strike + premium)],
      });
    }
  }

  if (trend === "trend-down") {
    for (const off of otmOffsets) {
      const strike = atm - off;
      const row = findStrike(chain, strike);
      if (!row || row.pe.ltp <= 1) continue;
      const premium = row.pe.ltp;
      results.push({
        direction: "BEARISH",
        legs: [makeLeg("BUY_PUT", strike, row.pe, lotSize)],
        netPremium: r2(-premium),
        maxProfit: r2(premium * 4 * lotSize),
        maxLoss: r2(premium * lotSize),
        breakeven: [r2(strike - premium)],
      });
    }
  }
  return results;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function findStrike(chain: OptionChainStrike[], strike: number): OptionChainStrike | undefined {
  return chain.find((s) => s.strike === strike);
}

function makeLeg(
  type: StrategyLeg["type"],
  strike: number,
  optData: { ltp: number; iv: number; oi: number },
  lotSize: number,
): StrategyLeg {
  return {
    type,
    strike,
    premium: r2(optData.ltp),
    iv: r2(optData.iv),
    oi: optData.oi,
    qty: 1,
    lotSize,
  };
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}
