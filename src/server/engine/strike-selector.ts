/**
 * Strike Selector — Options SELLER Focused
 *
 * For each strategy, picks optimal strikes based on:
 *   - Max OI (strong walls = safe sell strikes)
 *   - Width from ATM (wider = more premium safety)
 *   - Risk-reward ratio (credit collected vs max loss)
 *   - IV skew (sell expensive side)
 *   - Greeks (delta targeting for sells)
 *
 * All primary strategies are SELL-side:
 *   Iron Condor, Credit Spread, Short Straddle, Short Strangle, Scalp Sell
 * Buyer strategies only shown in extreme conditions:
 *   Debit Spread, Directional Buy
 */

import { StrategyType, StrategyLeg, TradeDirection } from "@/types/strategy";
import { OptionChainStrike } from "@/types/market";

const NIFTY_LOT = 75;
const NIFTY_STEP = 50;

export interface StrikeSelection {
  legs: StrategyLeg[];
  direction: TradeDirection;
  netPremium: number;      // positive = credit, negative = debit
  maxProfit: number;
  maxLoss: number;
  breakeven: number[];
}

// ─── Main Strike Selection ──────────────────

export function selectStrikes(
  strategy: StrategyType,
  spot: number,
  chain: OptionChainStrike[],
  trend: string,
  lotSize: number = NIFTY_LOT,
): StrikeSelection[] {
  const atm = Math.round(spot / NIFTY_STEP) * NIFTY_STEP;

  switch (strategy) {
    case "IRON_CONDOR":
      return selectIronCondor(chain, atm, spot, lotSize);
    case "CREDIT_SPREAD":
      return selectCreditSpread(chain, atm, spot, trend, lotSize);
    case "SHORT_STRADDLE":
      return selectShortStraddle(chain, atm, lotSize);
    case "SHORT_STRANGLE":
      return selectShortStrangle(chain, atm, lotSize);
    case "SCALP_SELL":
      return selectScalpSell(chain, atm, spot, trend, lotSize);
    case "DEBIT_SPREAD":
      return selectDebitSpread(chain, atm, spot, trend, lotSize);
    case "DIRECTIONAL_BUY":
      return selectDirectionalBuy(chain, atm, spot, trend, lotSize);
    default:
      return [];
  }
}

// ─── Iron Condor ────────────────────────────

function selectIronCondor(
  chain: OptionChainStrike[],
  atm: number,
  spot: number,
  lotSize: number,
): StrikeSelection[] {
  const results: StrikeSelection[] = [];

  // Try different widths: 200, 300, 400 from ATM
  for (const width of [200, 300, 400]) {
    const sellCallStrike = atm + width;
    const buyCallStrike = sellCallStrike + NIFTY_STEP * 2; // 100 pts protection
    const sellPutStrike = atm - width;
    const buyPutStrike = sellPutStrike - NIFTY_STEP * 2;

    const sellCall = findStrike(chain, sellCallStrike);
    const buyCall = findStrike(chain, buyCallStrike);
    const sellPut = findStrike(chain, sellPutStrike);
    const buyPut = findStrike(chain, buyPutStrike);

    if (!sellCall || !buyCall || !sellPut || !buyPut) continue;

    const sellCallPrem = sellCall.ce.ltp;
    const buyCallPrem = buyCall.ce.ltp;
    const sellPutPrem = sellPut.pe.ltp;
    const buyPutPrem = buyPut.pe.ltp;

    if (sellCallPrem <= 0 || sellPutPrem <= 0) continue;

    const netCredit = (sellCallPrem - buyCallPrem + sellPutPrem - buyPutPrem);
    const spreadWidth = (buyCallStrike - sellCallStrike);
    const maxLoss = (spreadWidth - netCredit) * lotSize;
    const maxProfit = netCredit * lotSize;

    if (maxProfit <= 0 || maxLoss <= 0) continue;

    const beUpper = sellCallStrike + netCredit;
    const beLower = sellPutStrike - netCredit;

    results.push({
      direction: "NEUTRAL",
      legs: [
        makeLeg("SELL_CALL", sellCallStrike, sellCall.ce, lotSize),
        makeLeg("BUY_CALL", buyCallStrike, buyCall.ce, lotSize),
        makeLeg("SELL_PUT", sellPutStrike, sellPut.pe, lotSize),
        makeLeg("BUY_PUT", buyPutStrike, buyPut.pe, lotSize),
      ],
      netPremium: r2(netCredit),
      maxProfit: r2(maxProfit),
      maxLoss: r2(maxLoss),
      breakeven: [r2(beLower), r2(beUpper)],
    });
  }

  return results;
}

// ─── Credit Spread ──────────────────────────

function selectCreditSpread(
  chain: OptionChainStrike[],
  atm: number,
  spot: number,
  trend: string,
  lotSize: number,
): StrikeSelection[] {
  const results: StrikeSelection[] = [];

  // Bull Put Spread (bullish credit spread)
  if (trend === "trend-up" || trend === "range-bound") {
    for (const dist of [100, 150, 200, 250]) {
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
  }

  // Bear Call Spread (bearish credit spread)
  if (trend === "trend-down" || trend === "range-bound") {
    for (const dist of [100, 150, 200, 250]) {
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
  }

  return results;
}

// ─── Debit Spread ───────────────────────────

function selectDebitSpread(
  chain: OptionChainStrike[],
  atm: number,
  spot: number,
  trend: string,
  lotSize: number,
): StrikeSelection[] {
  const results: StrikeSelection[] = [];

  // Bull Call Spread
  if (trend === "trend-up") {
    for (const sellDist of [100, 150, 200]) {
      const buyStrike = atm;
      const sellStrike = atm + sellDist;
      const buy = findStrike(chain, buyStrike);
      const sell = findStrike(chain, sellStrike);
      if (!buy || !sell) continue;

      const debit = buy.ce.ltp - sell.ce.ltp;
      if (debit <= 0) continue;

      const width = sellStrike - buyStrike;
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
  }

  // Bear Put Spread
  if (trend === "trend-down") {
    for (const sellDist of [100, 150, 200]) {
      const buyStrike = atm;
      const sellStrike = atm - sellDist;
      const buy = findStrike(chain, buyStrike);
      const sell = findStrike(chain, sellStrike);
      if (!buy || !sell) continue;

      const debit = buy.pe.ltp - sell.pe.ltp;
      if (debit <= 0) continue;

      const width = buyStrike - sellStrike;
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
  }

  return results;
}

// ─── Directional Buy ────────────────────────

function selectDirectionalBuy(
  chain: OptionChainStrike[],
  atm: number,
  spot: number,
  trend: string,
  lotSize: number,
): StrikeSelection[] {
  const results: StrikeSelection[] = [];
  const offsets = [0, NIFTY_STEP, -NIFTY_STEP]; // ATM, 1 OTM, 1 ITM

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
        maxProfit: r2(premium * 3 * lotSize), // rough 3x target
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

// ─── Short Straddle (SELL ATM CE + PE) ──────

function selectShortStraddle(
  chain: OptionChainStrike[],
  atm: number,
  lotSize: number,
): StrikeSelection[] {
  const row = findStrike(chain, atm);
  if (!row || row.ce.ltp <= 0 || row.pe.ltp <= 0) return [];

  const totalCredit = row.ce.ltp + row.pe.ltp;

  // Short straddle: unlimited risk, profit = total credit collected
  // Breakeven = ATM ± total credit
  return [{
    direction: "NEUTRAL",
    legs: [
      makeLeg("SELL_CALL", atm, row.ce, lotSize),
      makeLeg("SELL_PUT", atm, row.pe, lotSize),
    ],
    netPremium: r2(totalCredit),
    maxProfit: r2(totalCredit * lotSize),
    maxLoss: r2(totalCredit * 3 * lotSize), // approximate — suggest SL at 2-3x premium
    breakeven: [r2(atm - totalCredit), r2(atm + totalCredit)],
  }];
}

// ─── Short Strangle (SELL OTM CE + PE) ──────

function selectShortStrangle(
  chain: OptionChainStrike[],
  atm: number,
  lotSize: number,
): StrikeSelection[] {
  const results: StrikeSelection[] = [];

  for (const width of [100, 150, 200, 250]) {
    const callStrike = atm + width;
    const putStrike = atm - width;
    const call = findStrike(chain, callStrike);
    const put = findStrike(chain, putStrike);
    if (!call || !put || call.ce.ltp <= 0 || put.pe.ltp <= 0) continue;

    const totalCredit = call.ce.ltp + put.pe.ltp;
    if (totalCredit <= 5) continue; // skip if premium too thin

    results.push({
      direction: "NEUTRAL",
      legs: [
        makeLeg("SELL_CALL", callStrike, call.ce, lotSize),
        makeLeg("SELL_PUT", putStrike, put.pe, lotSize),
      ],
      netPremium: r2(totalCredit),
      maxProfit: r2(totalCredit * lotSize),
      maxLoss: r2(totalCredit * 3 * lotSize), // approximate SL at 3x
      breakeven: [r2(putStrike - totalCredit), r2(callStrike + totalCredit)],
    });
  }

  return results;
}

// ─── Scalp Sell (Quick OTM sell for theta/premium capture) ─────

function selectScalpSell(
  chain: OptionChainStrike[],
  atm: number,
  spot: number,
  trend: string,
  lotSize: number,
): StrikeSelection[] {
  const results: StrikeSelection[] = [];

  // SELL OTM option on the CONTRA side for quick premium capture
  // Bullish market → sell OTM PE (below support)
  // Bearish market → sell OTM CE (above resistance)
  // Range-bound → sell both sides

  if (trend === "trend-up" || trend === "range-bound") {
    // Sell OTM PE — market going up, put decays
    for (const dist of [100, 150, 200]) {
      const strike = atm - dist;
      const row = findStrike(chain, strike);
      if (!row || row.pe.ltp <= 2) continue; // need min ₹2 premium

      const credit = row.pe.ltp;
      results.push({
        direction: "BULLISH",
        legs: [makeLeg("SELL_PUT", strike, row.pe, lotSize)],
        netPremium: r2(credit),
        maxProfit: r2(credit * lotSize),
        maxLoss: r2(credit * 2.5 * lotSize), // SL at 2.5x premium
        breakeven: [r2(strike - credit)],
      });
    }
  }

  if (trend === "trend-down" || trend === "range-bound") {
    // Sell OTM CE — market going down, call decays
    for (const dist of [100, 150, 200]) {
      const strike = atm + dist;
      const row = findStrike(chain, strike);
      if (!row || row.ce.ltp <= 2) continue;

      const credit = row.ce.ltp;
      results.push({
        direction: "BEARISH",
        legs: [makeLeg("SELL_CALL", strike, row.ce, lotSize)],
        netPremium: r2(credit),
        maxProfit: r2(credit * lotSize),
        maxLoss: r2(credit * 2.5 * lotSize),
        breakeven: [r2(strike + credit)],
      });
    }
  }

  return results;
}

// ─── Helpers ────────────────────────────────

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
