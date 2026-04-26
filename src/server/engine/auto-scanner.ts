/**
 * Auto-Scanner Engine — Intraday NIFTY Options Trade Finder
 *
 * Continuously evaluates the live options chain to find the SINGLE BEST
 * intraday trade that can realistically deliver ~2% daily return on capital.
 *
 * Key philosophy (options SELLER focused):
 *   1. Scan ALL strategies (sell-side priority) with real strike data
 *   2. Calculate WIN PROBABILITY from option delta (market-implied)
 *   3. Calculate EXPECTED VALUE per lot → only show +EV trades
 *   4. Factor in: OI walls, IV edge, trend, S/R, theta decay
 *   5. Rank by Expected Value × Win Probability (Kelly-like)
 *   6. Output the single best trade with full reasoning
 *
 * Target: ₹3,000–5,000 profit per lot on ₹1.5L–2.5L margin = ~2% daily.
 *
 * Trade Categories Scanned:
 *   A. Sell OTM PE (bullish bias) — most frequent winner
 *   B. Sell OTM CE (bearish bias) — trend-down scalp
 *   C. Credit Spread PE (bull put) — limited risk sell
 *   D. Credit Spread CE (bear call) — limited risk sell
 *   E. Short Strangle (neutral) — range-bound
 *   F. Iron Condor (neutral, limited risk) — range-bound
 *   G. Buy CE/PE (directional) — only on strong breakout
 */

import { MarketIndicators, OptionChainRow, OptionChainStrike, OptionsChainResponse } from "@/types/market";
import { TechnicalSnapshot } from "@/server/market-data/technicals";
import type { ProfessionalIndicatorBundle } from "@/server/market-data/professional-indicators";
import type { FiiDiiSnapshot, FiiDiiUnavailable } from "@/server/market-data/fii-dii";
import { buildProTradeSignal, type ProTradeSignal } from "./scan-signal";
import { buildScanTradingAlgo, type ScanTradingAlgo } from "./scan-trading-algo";

// ─── Types ───────────────────────────────────

export type ScanTradeType =
  | "SELL_PE"         // naked sell put (bullish)
  | "SELL_CE"         // naked sell call (bearish)
  | "BULL_PUT_SPREAD" // credit spread (bullish, limited risk)
  | "BEAR_CALL_SPREAD"// credit spread (bearish, limited risk)
  | "SHORT_STRANGLE"  // sell both sides (neutral)
  | "IRON_CONDOR"     // sell both spreads (neutral, limited risk)
  | "BUY_CE"          // directional long call
  | "BUY_PE";         // directional long put

export interface ScanLeg {
  action: "BUY" | "SELL";
  optionType: "CE" | "PE";
  strike: number;
  premium: number;       // LTP
  iv: number;
  delta: number;         // absolute delta
  oi: number;
  changeInOi: number;
  volume: number;
  /** 5paisa ScripCode for order placement (NSE F&O) */
  scripCode?: number;
}

export interface ScanTrade {
  id: string;
  tradeType: ScanTradeType;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  legs: ScanLeg[];

  // ─── Financial ──────────────────
  netCredit: number;           // per-lot ₹ (positive = credit, negative = debit)
  maxProfit: number;           // per-lot ₹
  maxLoss: number;             // per-lot ₹ (always positive)
  breakeven: number[];
  marginRequired: number;      // approximate ₹

  // ─── Probabilities ─────────────
  winProbability: number;      // 0-100% (from delta)
  expectedValue: number;       // ₹ per lot = (winProb × maxProfit) - (lossProb × maxLoss)
  riskReward: number;          // maxProfit / maxLoss
  kellyScore: number;          // combined EV × winProb ranking metric

  // ─── Context ───────────────────
  score: number;               // 0-100 composite score
  edge: string;                // one-line "why this trade"
  rationale: string[];         // detailed reasoning
  warnings: string[];          // risk warnings
  oiWall: string;              // "Max PE OI at 24000 (12.5L) acts as support"
  thetaDecayPerDay: number;    // ₹ approximate theta income per day
  targetTime: string;          // "30 min" | "1 hr" | "Expiry day"
}

export interface ScanResult {
  bestTrade: ScanTrade | null;
  alternates: ScanTrade[];     // top 3 alternatives
  /** Top credit (selling) structures by model rank — always populated when chain exists */
  topCreditStrategies: ScanTrade[];
  marketBias: "BULLISH" | "BEARISH" | "NEUTRAL";
  biasStrength: number;        // 0-100
  scanTimestamp: string;
  marketContext: {
    spot: number;
    spotChange: number;
    spotChangePct: number;
    vix: number;
    pcr: number;
    trend: string;
    trendStrength: number;
    ivPercentile: number;
    maxCallOI: { strike: number; oi: number };
    maxPutOI: { strike: number; oi: number };
    atmIV: number;
    atmStraddle: number;       // ATM CE+PE premium
    expectedMove: number;      // ±points based on straddle
    daysToExpiry: number;
  };
  professionalIndicators: ProfessionalIndicatorBundle;
  fiiDii: FiiDiiSnapshot | FiiDiiUnavailable | null;
  proSignal: ProTradeSignal;
  /** Entry/exit targets, alerts, and suggested action (algo layer on top of pro signal) */
  tradingAlgo: ScanTradingAlgo;
}

export interface AutoScanInput {
  chain: OptionsChainResponse;
  indicators: MarketIndicators;
  technicals: TechnicalSnapshot;
  spot: number;
  capital: number;             // total capital for 2% target calc
  lotSize: number;
  proBundle?: ProfessionalIndicatorBundle;
  fiiDii?: FiiDiiSnapshot | FiiDiiUnavailable | null;
}

// ─── Constants ───────────────────────────────

const NIFTY_STEP = 50;
const LOT_SIZE = 75;
const DEFAULT_CAPITAL = 200_000; // ₹2L for 2% = ₹4,000 target

const EMPTY_PRO: ProfessionalIndicatorBundle = {
  macd: null,
  bollinger: null,
  stochastic: null,
  chain: null,
  oiInsights: null,
};

// ─── Main Scanner ────────────────────────────

export function runAutoScan(input: AutoScanInput): ScanResult {
  const { chain, indicators: ind, technicals: tech, spot, lotSize } = input;
  const capital = input.capital || DEFAULT_CAPITAL;
  const target2Pct = capital * 0.02;
  const atm = Math.round(spot / NIFTY_STEP) * NIFTY_STEP;
  const strikes = chain.chain;

  if (strikes.length === 0) {
    return emptyScanResult(spot, ind, tech);
  }

  // ─── 1. Determine Market Bias ──────────────
  const { bias, biasStrength } = determineBias(tech, ind);

  // ─── 2. Compute context metrics ────────────
  const atmRow = findStrike(strikes, atm);
  const atmStraddle = atmRow ? (atmRow.ce.ltp + atmRow.pe.ltp) : 0;
  const expectedMove = Math.round(atmStraddle * 0.85); // ~85% of straddle = 1 SD move
  const atmIV = atmRow ? ((atmRow.ce.iv + atmRow.pe.iv) / 2) : ind.vix;

  const maxCallOI = findMaxOI(strikes, "ce");
  const maxPutOI = findMaxOI(strikes, "pe");

  // ─── 3. Generate ALL candidate trades ──────
  const candidates: ScanTrade[] = [];

  // A. Naked sell OTM PE (bullish)
  if (bias === "BULLISH" || bias === "NEUTRAL") {
    candidates.push(...scanSellPE(strikes, atm, spot, lotSize, ind, maxPutOI));
  }

  // B. Naked sell OTM CE (bearish)
  if (bias === "BEARISH" || bias === "NEUTRAL") {
    candidates.push(...scanSellCE(strikes, atm, spot, lotSize, ind, maxCallOI));
  }

  // C. Bull Put Credit Spread
  if (bias === "BULLISH" || bias === "NEUTRAL") {
    candidates.push(...scanBullPutSpread(strikes, atm, spot, lotSize, ind));
  }

  // D. Bear Call Credit Spread
  if (bias === "BEARISH" || bias === "NEUTRAL") {
    candidates.push(...scanBearCallSpread(strikes, atm, spot, lotSize, ind));
  }

  // E. Short Strangle — premium sell in all trends (OTM straddle income)
  candidates.push(...scanShortStrangle(strikes, atm, spot, lotSize, ind));

  // F. Iron Condor — defined-risk credit; available in all regimes
  candidates.push(...scanIronCondor(strikes, atm, spot, lotSize, ind));

  // G. Directional Buy (only strong trend)
  if (biasStrength >= 70) {
    candidates.push(...scanDirectionalBuy(strikes, atm, spot, lotSize, ind, bias));
  }

  // ─── 4. Score & Enrich each candidate ──────
  for (const trade of candidates) {
    enrichTrade(trade, ind, tech, maxCallOI, maxPutOI, target2Pct, capital);
  }

  const isNakedShortPremium = (t: ScanTrade) =>
    t.netCredit > 0 && (t.tradeType === "SELL_PE" || t.tradeType === "SELL_CE");

  const isDefinedRiskCredit = (t: ScanTrade) =>
    t.netCredit > 0 &&
    (t.tradeType === "IRON_CONDOR" ||
      t.tradeType === "BULL_PUT_SPREAD" ||
      t.tradeType === "BEAR_CALL_SPREAD" ||
      t.tradeType === "SHORT_STRANGLE");

  const adjustedRank = (t: ScanTrade): number => {
    if (t.netCredit <= 0) return t.kellyScore;
    const spreadBonus = isDefinedRiskCredit(t) ? 1.25 : 1.0;
    let r = t.kellyScore * 1.35 * spreadBonus;
    if (isNakedShortPremium(t)) r *= 0.22;
    return r;
  };

  // ─── 5. Rank: prefer credit (selling) over debit when scores are close ─
  candidates.sort((a, b) => adjustedRank(b) - adjustedRank(a));

  // ─── 6. Top credit ideas: multi-leg / defined risk first, then single-leg ────
  const posCredit = candidates.filter((t) => t.netCredit > 0);
  const multiLeg = posCredit
    .filter((t) => t.legs.length >= 2)
    .sort((a, b) => adjustedRank(b) - adjustedRank(a));
  const singleLeg = posCredit
    .filter((t) => t.legs.length === 1)
    .sort((a, b) => adjustedRank(b) - adjustedRank(a));
  const topCreditStrategies: ScanTrade[] = [
    ...multiLeg.slice(0, 5),
    ...singleLeg.slice(0, Math.max(0, 5 - multiLeg.length)),
  ].slice(0, 5);

  // ─── 7. Best pick: +EV; fall back to best credit if nothing passes strict filter ─
  const strict = (t: ScanTrade) => t.expectedValue > 0 && t.score >= 40;
  let positiveEV = candidates.filter(strict);
  if (positiveEV.length === 0) {
    positiveEV = candidates.filter(
      (t) => t.netCredit > 0 && t.expectedValue > 0 && t.score >= 32,
    );
  }
  if (positiveEV.length === 0) {
    positiveEV = candidates
      .filter((t) => t.netCredit > 0 && t.score >= 25)
      .sort((a, b) => adjustedRank(b) - adjustedRank(a))
      .slice(0, 5);
  }
  if (positiveEV.length === 0) {
    positiveEV = topCreditStrategies.length ? topCreditStrategies.slice(0, 1) : [];
  }

  const firstHedged = positiveEV.find((t) => t.legs.length >= 2);
  const bestTrade: ScanTrade | null = firstHedged ?? (positiveEV.length > 0 ? positiveEV[0] : null);
  const alternates = (bestTrade
    ? positiveEV.filter((t) => t.id !== bestTrade.id)
    : positiveEV
  ).slice(0, 3);

  const pro = input.proBundle ?? EMPTY_PRO;
  const fii = input.fiiDii ?? null;
  const proSignal = buildProTradeSignal(bestTrade, ind, tech, spot, pro, fii);

  const tradingAlgo = buildScanTradingAlgo({
    bestTrade,
    proSignal,
    marketContext: {
      spot,
      vix: ind.vix,
      expectedMove,
      daysToExpiry: ind.daysToExpiry,
    },
  });

  return {
    bestTrade,
    alternates,
    topCreditStrategies,
    marketBias: bias,
    biasStrength,
    scanTimestamp: new Date().toISOString(),
    marketContext: {
      spot,
      spotChange: ind.spotChange,
      spotChangePct: ind.spotChangePct,
      vix: ind.vix,
      pcr: ind.pcr,
      trend: ind.trend,
      trendStrength: ind.trendStrength,
      ivPercentile: ind.ivPercentile,
      maxCallOI,
      maxPutOI,
      atmIV,
      atmStraddle: r2(atmStraddle),
      expectedMove,
      daysToExpiry: ind.daysToExpiry,
    },
    professionalIndicators: pro,
    fiiDii: fii,
    proSignal,
    tradingAlgo,
  };
}

// ══════════════════════════════════════════════
//  Trade Candidate Generators
// ══════════════════════════════════════════════

function scanSellPE(
  strikes: OptionChainStrike[], atm: number, spot: number,
  lotSize: number, ind: MarketIndicators, maxPutOI: { strike: number; oi: number },
): ScanTrade[] {
  const results: ScanTrade[] = [];
  // Sell OTM PE: 100-300 pts below ATM
  for (const dist of [100, 150, 200, 250, 300]) {
    const strike = atm - dist;
    const row = findStrike(strikes, strike);
    if (!row || row.pe.ltp < 3) continue;

    const premium = row.pe.ltp;
    const delta = Math.abs(row.pe.greeks?.delta ?? 0);
    const winProb = (1 - delta) * 100; // OTM put delta = prob of expiring ITM

    const rationale: string[] = [];
    const warnings: string[] = [];

    // OI wall check
    if (maxPutOI.strike <= strike && maxPutOI.oi > 0) {
      rationale.push(`Max PE OI wall at ${maxPutOI.strike} (${formatLakh(maxPutOI.oi)}) provides support`);
    }
    if (ind.support.length > 0 && strike <= Math.min(...ind.support)) {
      rationale.push(`Strike ${strike} is below nearest support — safe buffer`);
    }
    if (delta > 0.25) {
      warnings.push(`Delta ${delta.toFixed(2)} is high — closer to ATM, higher risk`);
    }

    results.push({
      id: genId(),
      tradeType: "SELL_PE",
      direction: "BULLISH",
      legs: [{
        action: "SELL", optionType: "PE", strike, premium: r2(premium),
        iv: row.pe.iv, delta, oi: row.pe.oi,
        changeInOi: row.pe.changeInOi, volume: row.pe.volume,
        scripCode: scripFromLeg(row.pe),
      }],
      netCredit: r2(premium),
      maxProfit: r2(premium * lotSize),
      maxLoss: r2(premium * 2.5 * lotSize),   // SL at 2.5x
      breakeven: [r2(strike - premium)],
      marginRequired: estimateMargin(spot, premium, "sell", lotSize),
      winProbability: r2(winProb),
      expectedValue: 0, riskReward: 0, kellyScore: 0, score: 0,
      edge: "", rationale, warnings, oiWall: "",
      thetaDecayPerDay: r2(Math.abs(row.pe.greeks?.theta ?? 0) * lotSize),
      targetTime: "Expiry day",
    });
  }
  return results;
}

function scanSellCE(
  strikes: OptionChainStrike[], atm: number, spot: number,
  lotSize: number, ind: MarketIndicators, maxCallOI: { strike: number; oi: number },
): ScanTrade[] {
  const results: ScanTrade[] = [];
  for (const dist of [100, 150, 200, 250, 300]) {
    const strike = atm + dist;
    const row = findStrike(strikes, strike);
    if (!row || row.ce.ltp < 3) continue;

    const premium = row.ce.ltp;
    const delta = Math.abs(row.ce.greeks?.delta ?? 0);
    const winProb = (1 - delta) * 100;

    const rationale: string[] = [];
    const warnings: string[] = [];

    if (maxCallOI.strike >= strike && maxCallOI.oi > 0) {
      rationale.push(`Max CE OI wall at ${maxCallOI.strike} (${formatLakh(maxCallOI.oi)}) acts as resistance`);
    }
    if (ind.resistance.length > 0 && strike >= Math.max(...ind.resistance)) {
      rationale.push(`Strike ${strike} is above nearest resistance — safe buffer`);
    }
    if (delta > 0.25) {
      warnings.push(`Delta ${delta.toFixed(2)} is high — closer to ATM, higher risk`);
    }

    results.push({
      id: genId(),
      tradeType: "SELL_CE",
      direction: "BEARISH",
      legs: [{
        action: "SELL", optionType: "CE", strike, premium: r2(premium),
        iv: row.ce.iv, delta, oi: row.ce.oi,
        changeInOi: row.ce.changeInOi, volume: row.ce.volume,
        scripCode: scripFromLeg(row.ce),
      }],
      netCredit: r2(premium),
      maxProfit: r2(premium * lotSize),
      maxLoss: r2(premium * 2.5 * lotSize),
      breakeven: [r2(strike + premium)],
      marginRequired: estimateMargin(spot, premium, "sell", lotSize),
      winProbability: r2(winProb),
      expectedValue: 0, riskReward: 0, kellyScore: 0, score: 0,
      edge: "", rationale, warnings, oiWall: "",
      thetaDecayPerDay: r2(Math.abs(row.ce.greeks?.theta ?? 0) * lotSize),
      targetTime: "Expiry day",
    });
  }
  return results;
}

/** Min net credit (₹/share) to accept; keeps tiny / negative-edge spreads from crowding the list. */
const MIN_SPREAD_CREDIT = 0.15;

function scanBullPutSpread(
  strikes: OptionChainStrike[], atm: number, spot: number,
  lotSize: number, ind: MarketIndicators,
): ScanTrade[] {
  const results: ScanTrade[] = [];
  const wingWidths = [NIFTY_STEP, NIFTY_STEP * 2, NIFTY_STEP * 3, NIFTY_STEP * 4]; // 50,100,150,200

  for (const sellDist of [100, 150, 200]) {
    const sellStrike = atm - sellDist;
    const sell = findStrike(strikes, sellStrike);
    if (!sell) continue;

    for (const width of wingWidths) {
      const buyStrike = sellStrike - width;
      if (buyStrike <= 0) continue;
      const buy = findStrike(strikes, buyStrike);
      if (!buy) continue;

      const credit = sell.pe.ltp - buy.pe.ltp;
      if (credit <= MIN_SPREAD_CREDIT) continue;

      const effWidth = sellStrike - buyStrike;
      if (effWidth <= 0) continue;
      const maxProfit = credit * lotSize;
      const maxLoss = (effWidth - credit) * lotSize;
      if (maxLoss <= 0) continue;

      const sellDelta = Math.abs(sell.pe.greeks?.delta ?? 0);
      const winProb = (1 - sellDelta) * 100;

      results.push({
        id: genId(),
        tradeType: "BULL_PUT_SPREAD",
        direction: "BULLISH",
        legs: [
          { action: "SELL", optionType: "PE", strike: sellStrike, premium: r2(sell.pe.ltp),
            iv: sell.pe.iv, delta: sellDelta, oi: sell.pe.oi,
            changeInOi: sell.pe.changeInOi, volume: sell.pe.volume,
            scripCode: scripFromLeg(sell.pe) },
          { action: "BUY", optionType: "PE", strike: buyStrike, premium: r2(buy.pe.ltp),
            iv: buy.pe.iv, delta: Math.abs(buy.pe.greeks?.delta ?? 0), oi: buy.pe.oi,
            changeInOi: buy.pe.changeInOi, volume: buy.pe.volume,
            scripCode: scripFromLeg(buy.pe) },
        ],
        netCredit: r2(credit),
        maxProfit: r2(maxProfit),
        maxLoss: r2(maxLoss),
        breakeven: [r2(sellStrike - credit)],
        marginRequired: r2(maxLoss * 1.1), // limited risk = max loss + buffer
        winProbability: r2(winProb),
        expectedValue: 0, riskReward: 0, kellyScore: 0, score: 0,
        edge: "", rationale: [`Bull Put Spread: Sell ${sellStrike}PE / Buy ${buyStrike}PE for ₹${r2(credit)} credit (wing ${width}pt)`],
        warnings: [], oiWall: "",
        thetaDecayPerDay: r2(Math.abs(sell.pe.greeks?.theta ?? 0) * lotSize),
        targetTime: "Expiry day",
      });
    }
  }
  return results;
}

function scanBearCallSpread(
  strikes: OptionChainStrike[], atm: number, spot: number,
  lotSize: number, ind: MarketIndicators,
): ScanTrade[] {
  const results: ScanTrade[] = [];
  const wingWidths = [NIFTY_STEP, NIFTY_STEP * 2, NIFTY_STEP * 3, NIFTY_STEP * 4];

  for (const sellDist of [100, 150, 200]) {
    const sellStrike = atm + sellDist;
    const sell = findStrike(strikes, sellStrike);
    if (!sell) continue;

    for (const width of wingWidths) {
      const buyStrike = sellStrike + width;
      const buy = findStrike(strikes, buyStrike);
      if (!buy) continue;

      const credit = sell.ce.ltp - buy.ce.ltp;
      if (credit <= MIN_SPREAD_CREDIT) continue;

      const widthPts = buyStrike - sellStrike;
      const maxProfit = credit * lotSize;
      const maxLoss = (widthPts - credit) * lotSize;
      if (maxLoss <= 0) continue;

      const sellDelta = Math.abs(sell.ce.greeks?.delta ?? 0);
      const winProb = (1 - sellDelta) * 100;

      results.push({
        id: genId(),
        tradeType: "BEAR_CALL_SPREAD",
        direction: "BEARISH",
        legs: [
          { action: "SELL", optionType: "CE", strike: sellStrike, premium: r2(sell.ce.ltp),
            iv: sell.ce.iv, delta: sellDelta, oi: sell.ce.oi,
            changeInOi: sell.ce.changeInOi, volume: sell.ce.volume,
            scripCode: scripFromLeg(sell.ce) },
          { action: "BUY", optionType: "CE", strike: buyStrike, premium: r2(buy.ce.ltp),
            iv: buy.ce.iv, delta: Math.abs(buy.ce.greeks?.delta ?? 0), oi: buy.ce.oi,
            changeInOi: buy.ce.changeInOi, volume: buy.ce.volume,
            scripCode: scripFromLeg(buy.ce) },
        ],
        netCredit: r2(credit),
        maxProfit: r2(maxProfit),
        maxLoss: r2(maxLoss),
        breakeven: [r2(sellStrike + credit)],
        marginRequired: r2(maxLoss * 1.1),
        winProbability: r2(winProb),
        expectedValue: 0, riskReward: 0, kellyScore: 0, score: 0,
        edge: "", rationale: [`Bear Call Spread: Sell ${sellStrike}CE / Buy ${buyStrike}CE for ₹${r2(credit)} credit (wing ${width}pt)`],
        warnings: [], oiWall: "",
        thetaDecayPerDay: r2(Math.abs(sell.ce.greeks?.theta ?? 0) * lotSize),
        targetTime: "Expiry day",
      });
    }
  }
  return results;
}

function scanShortStrangle(
  strikes: OptionChainStrike[], atm: number, spot: number,
  lotSize: number, ind: MarketIndicators,
): ScanTrade[] {
  const results: ScanTrade[] = [];
  for (const width of [100, 150, 200, 250]) {
    const callStrike = atm + width;
    const putStrike = atm - width;
    const call = findStrike(strikes, callStrike);
    const put = findStrike(strikes, putStrike);
    if (!call || !put || call.ce.ltp < 3 || put.pe.ltp < 3) continue;

    const credit = call.ce.ltp + put.pe.ltp;
    const callDelta = Math.abs(call.ce.greeks?.delta ?? 0);
    const putDelta = Math.abs(put.pe.greeks?.delta ?? 0);
    // Win prob = both legs expire OTM
    const winProb = (1 - callDelta) * (1 - putDelta) * 100;

    results.push({
      id: genId(),
      tradeType: "SHORT_STRANGLE",
      direction: "NEUTRAL",
      legs: [
        { action: "SELL", optionType: "CE", strike: callStrike, premium: r2(call.ce.ltp),
          iv: call.ce.iv, delta: callDelta, oi: call.ce.oi,
          changeInOi: call.ce.changeInOi, volume: call.ce.volume,
          scripCode: scripFromLeg(call.ce) },
        { action: "SELL", optionType: "PE", strike: putStrike, premium: r2(put.pe.ltp),
          iv: put.pe.iv, delta: putDelta, oi: put.pe.oi,
          changeInOi: put.pe.changeInOi, volume: put.pe.volume,
          scripCode: scripFromLeg(put.pe) },
      ],
      netCredit: r2(credit),
      maxProfit: r2(credit * lotSize),
      maxLoss: r2(credit * 3 * lotSize),
      breakeven: [r2(putStrike - credit), r2(callStrike + credit)],
      marginRequired: estimateMargin(spot, credit, "strangle", lotSize),
      winProbability: r2(winProb),
      expectedValue: 0, riskReward: 0, kellyScore: 0, score: 0,
      edge: "", rationale: [`Short Strangle: Sell ${callStrike}CE + ${putStrike}PE for ₹${r2(credit)} total credit`],
      warnings: ["⚠️ Unlimited risk on both sides — strict SL mandatory"],
      oiWall: "",
      thetaDecayPerDay: r2((Math.abs(call.ce.greeks?.theta ?? 0) + Math.abs(put.pe.greeks?.theta ?? 0)) * lotSize),
      targetTime: "Expiry day",
    });
  }
  return results;
}

function scanIronCondor(
  strikes: OptionChainStrike[], atm: number, spot: number,
  lotSize: number, ind: MarketIndicators,
): ScanTrade[] {
  const results: ScanTrade[] = [];
  for (const width of [200, 300]) {
    const sellCall = atm + width;
    const buyCall = sellCall + NIFTY_STEP * 2;
    const sellPut = atm - width;
    const buyPut = sellPut - NIFTY_STEP * 2;

    const sc = findStrike(strikes, sellCall);
    const bc = findStrike(strikes, buyCall);
    const sp = findStrike(strikes, sellPut);
    const bp = findStrike(strikes, buyPut);
    if (!sc || !bc || !sp || !bp) continue;

    const credit = (sc.ce.ltp - bc.ce.ltp) + (sp.pe.ltp - bp.pe.ltp);
    if (credit <= 2) continue;

    const spreadWidth = buyCall - sellCall; // same on both sides
    const maxLoss = (spreadWidth - credit) * lotSize;
    const maxProfit = credit * lotSize;

    const callDelta = Math.abs(sc.ce.greeks?.delta ?? 0);
    const putDelta = Math.abs(sp.pe.greeks?.delta ?? 0);
    const winProb = (1 - callDelta) * (1 - putDelta) * 100;

    results.push({
      id: genId(),
      tradeType: "IRON_CONDOR",
      direction: "NEUTRAL",
      legs: [
        { action: "SELL", optionType: "CE", strike: sellCall, premium: r2(sc.ce.ltp),
          iv: sc.ce.iv, delta: callDelta, oi: sc.ce.oi,
          changeInOi: sc.ce.changeInOi, volume: sc.ce.volume,
          scripCode: scripFromLeg(sc.ce) },
        { action: "BUY", optionType: "CE", strike: buyCall, premium: r2(bc.ce.ltp),
          iv: bc.ce.iv, delta: Math.abs(bc.ce.greeks?.delta ?? 0), oi: bc.ce.oi,
          changeInOi: bc.ce.changeInOi, volume: bc.ce.volume,
          scripCode: scripFromLeg(bc.ce) },
        { action: "SELL", optionType: "PE", strike: sellPut, premium: r2(sp.pe.ltp),
          iv: sp.pe.iv, delta: putDelta, oi: sp.pe.oi,
          changeInOi: sp.pe.changeInOi, volume: sp.pe.volume,
          scripCode: scripFromLeg(sp.pe) },
        { action: "BUY", optionType: "PE", strike: buyPut, premium: r2(bp.pe.ltp),
          iv: bp.pe.iv, delta: Math.abs(bp.pe.greeks?.delta ?? 0), oi: bp.pe.oi,
          changeInOi: bp.pe.changeInOi, volume: bp.pe.volume,
          scripCode: scripFromLeg(bp.pe) },
      ],
      netCredit: r2(credit),
      maxProfit: r2(maxProfit),
      maxLoss: r2(maxLoss),
      breakeven: [r2(sellPut - credit), r2(sellCall + credit)],
      marginRequired: r2(maxLoss * 1.1),
      winProbability: r2(winProb),
      expectedValue: 0, riskReward: 0, kellyScore: 0, score: 0,
      edge: "", rationale: [`Iron Condor: ${sellPut}PE/${buyPut}PE — ${sellCall}CE/${buyCall}CE for ₹${r2(credit)} credit`],
      warnings: [], oiWall: "",
      thetaDecayPerDay: r2((Math.abs(sc.ce.greeks?.theta ?? 0) + Math.abs(sp.pe.greeks?.theta ?? 0)) * lotSize),
      targetTime: "Expiry day",
    });
  }
  return results;
}

function scanDirectionalBuy(
  strikes: OptionChainStrike[], atm: number, spot: number,
  lotSize: number, ind: MarketIndicators, bias: "BULLISH" | "BEARISH" | "NEUTRAL",
): ScanTrade[] {
  const results: ScanTrade[] = [];

  if (bias === "BULLISH") {
    for (const offset of [0, NIFTY_STEP]) {
      const strike = atm + offset;
      const row = findStrike(strikes, strike);
      if (!row || row.ce.ltp < 5) continue;
      const premium = row.ce.ltp;
      const delta = Math.abs(row.ce.greeks?.delta ?? 0.5);
      // Buy CE: win = ITM at expiry, probability = delta
      results.push({
        id: genId(),
        tradeType: "BUY_CE",
        direction: "BULLISH",
        legs: [{
          action: "BUY", optionType: "CE", strike, premium: r2(premium),
          iv: row.ce.iv, delta, oi: row.ce.oi,
          changeInOi: row.ce.changeInOi, volume: row.ce.volume,
          scripCode: scripFromLeg(row.ce),
        }],
        netCredit: r2(-premium),
        maxProfit: r2(premium * 2 * lotSize), // 2x target for directional
        maxLoss: r2(premium * lotSize),        // max loss = full premium
        breakeven: [r2(strike + premium)],
        marginRequired: r2(premium * lotSize),
        winProbability: r2(delta * 100),       // delta ≈ prob of ITM
        expectedValue: 0, riskReward: 0, kellyScore: 0, score: 0,
        edge: "", rationale: [`Buy ${strike}CE at ₹${r2(premium)} — strong bullish breakout expected`],
        warnings: ["⚠️ Buyer trade — theta works against you, needs quick move"],
        oiWall: "",
        thetaDecayPerDay: r2(Math.abs(row.ce.greeks?.theta ?? 0) * lotSize),
        targetTime: "30 min – 1 hr",
      });
    }
  }

  if (bias === "BEARISH") {
    for (const offset of [0, NIFTY_STEP]) {
      const strike = atm - offset;
      const row = findStrike(strikes, strike);
      if (!row || row.pe.ltp < 5) continue;
      const premium = row.pe.ltp;
      const delta = Math.abs(row.pe.greeks?.delta ?? 0.5);
      results.push({
        id: genId(),
        tradeType: "BUY_PE",
        direction: "BEARISH",
        legs: [{
          action: "BUY", optionType: "PE", strike, premium: r2(premium),
          iv: row.pe.iv, delta, oi: row.pe.oi,
          changeInOi: row.pe.changeInOi, volume: row.pe.volume,
          scripCode: scripFromLeg(row.pe),
        }],
        netCredit: r2(-premium),
        maxProfit: r2(premium * 2 * lotSize),
        maxLoss: r2(premium * lotSize),
        breakeven: [r2(strike - premium)],
        marginRequired: r2(premium * lotSize),
        winProbability: r2(delta * 100),
        expectedValue: 0, riskReward: 0, kellyScore: 0, score: 0,
        edge: "", rationale: [`Buy ${strike}PE at ₹${r2(premium)} — strong bearish breakdown expected`],
        warnings: ["⚠️ Buyer trade — theta works against you, needs quick move"],
        oiWall: "",
        thetaDecayPerDay: r2(Math.abs(row.pe.greeks?.theta ?? 0) * lotSize),
        targetTime: "30 min – 1 hr",
      });
    }
  }
  return results;
}

// ══════════════════════════════════════════════
//  Trade Enrichment — Score, EV, Kelly
// ══════════════════════════════════════════════

function enrichTrade(
  trade: ScanTrade,
  ind: MarketIndicators,
  tech: TechnicalSnapshot,
  maxCallOI: { strike: number; oi: number },
  maxPutOI: { strike: number; oi: number },
  target2Pct: number,
  capital: number,
): void {
  const isSeller = trade.netCredit > 0;
  const wp = trade.winProbability / 100;
  const lp = 1 - wp;

  // ─── Risk/Reward ──────────────────────────
  trade.riskReward = trade.maxLoss > 0
    ? r2(trade.maxProfit / trade.maxLoss)
    : trade.maxProfit > 0 ? 99 : 0;

  // ─── Expected Value ──────────────────────
  trade.expectedValue = r2((wp * trade.maxProfit) - (lp * trade.maxLoss));

  // ─── Composite Score (0-100) ─────────────
  let score = 0;

  // 1. Win Probability (25 pts) — higher is better
  score += Math.min(25, (wp * 30));

  // 2. Expected Value (25 pts)
  const evPct = trade.expectedValue / (trade.marginRequired || 1) * 100;
  if (evPct >= 3) score += 25;
  else if (evPct >= 1.5) score += 20;
  else if (evPct >= 0.5) score += 12;
  else if (evPct > 0) score += 5;

  // 3. OI Confirmation (15 pts) — sell leg behind OI wall
  const sellLegs = trade.legs.filter((l) => l.action === "SELL");
  for (const leg of sellLegs) {
    if (leg.optionType === "PE" && maxPutOI.strike > 0 && leg.strike <= maxPutOI.strike) {
      score += 8;
      trade.rationale.push(`✅ Sell PE ${leg.strike} backed by max PE OI wall at ${maxPutOI.strike}`);
    }
    if (leg.optionType === "CE" && maxCallOI.strike > 0 && leg.strike >= maxCallOI.strike) {
      score += 8;
      trade.rationale.push(`✅ Sell CE ${leg.strike} backed by max CE OI wall at ${maxCallOI.strike}`);
    }
    if (leg.oi > 0 && leg.changeInOi > 0) {
      score += 4;
      trade.rationale.push(`OI buildup at ${leg.strike} (Δ${formatLakh(leg.changeInOi)}) — writers adding positions`);
    }
  }
  score = Math.min(score, 65); // cap OI section

  // 4. Trend Alignment (15 pts)
  if (trade.direction === "BULLISH" && ind.trend === "trend-up") score += 15;
  else if (trade.direction === "BEARISH" && ind.trend === "trend-down") score += 15;
  else if (trade.direction === "NEUTRAL" && ind.trend === "range-bound") score += 15;
  else if (trade.direction === "NEUTRAL") score += 8; // neutral trades partially ok in trending
  else score += 3;

  // 5. IV Edge (10 pts) — sellers want HIGH IV, buyers want LOW IV
  if (isSeller) {
    if (ind.ivPercentile >= 50) { score += 10; trade.rationale.push(`IV Percentile ${ind.ivPercentile}% — rich premiums for selling`); }
    else if (ind.ivPercentile >= 30) score += 6;
    else score += 2;
  } else {
    if (ind.ivPercentile <= 25) { score += 10; trade.rationale.push(`IV Percentile ${ind.ivPercentile}% — cheap option to buy`); }
    else if (ind.ivPercentile <= 40) score += 6;
    else { score += 1; trade.warnings.push(`IV ${ind.ivPercentile}% — expensive premiums for buying`); }
  }

  // 6. Technical Confirmation (10 pts)
  if (trade.direction === "BULLISH") {
    if (tech.emaCrossover === "BULLISH") score += 3;
    if (tech.superTrendSignal === "BUY") score += 3;
    if (tech.priceVsVwap === "ABOVE") score += 2;
    if (tech.rsi >= 40 && tech.rsi <= 65) score += 2;
  } else if (trade.direction === "BEARISH") {
    if (tech.emaCrossover === "BEARISH") score += 3;
    if (tech.superTrendSignal === "SELL") score += 3;
    if (tech.priceVsVwap === "BELOW") score += 2;
    if (tech.rsi >= 35 && tech.rsi <= 60) score += 2;
  } else {
    // Neutral: low RSI strength + low momentum = good
    if (tech.rsi >= 40 && tech.rsi <= 60) score += 4;
    if (Math.abs(tech.momentum) < 0.5) score += 3;
    if (ind.trendStrength < 40) score += 3;
  }

  trade.score = Math.min(100, Math.round(score));

  // ─── Kelly Score (ranking metric) ─────────
  // EV-weighted: prioritize trades with high EV AND high win rate
  trade.kellyScore = r2(trade.expectedValue * wp * 100);

  // ─── OI Wall Summary ──────────────────────
  const walls: string[] = [];
  if (maxPutOI.oi > 0) walls.push(`PE wall: ${maxPutOI.strike} (${formatLakh(maxPutOI.oi)})`);
  if (maxCallOI.oi > 0) walls.push(`CE wall: ${maxCallOI.strike} (${formatLakh(maxCallOI.oi)})`);
  trade.oiWall = walls.join(" | ");

  // ─── Edge Summary ─────────────────────────
  const edgeParts: string[] = [];
  if (trade.winProbability >= 70) edgeParts.push(`${trade.winProbability}% win prob`);
  if (trade.expectedValue > 0) edgeParts.push(`+₹${trade.expectedValue} EV/lot`);
  if (trade.maxProfit >= target2Pct) edgeParts.push(`hits 2% target`);
  if (isSeller && ind.ivPercentile >= 40) edgeParts.push(`rich IV`);
  trade.edge = edgeParts.length > 0 ? edgeParts.join(" • ") : "Marginal edge";

  // ─── 2% Target Check ──────────────────────
  if (trade.maxProfit >= target2Pct) {
    trade.rationale.push(`🎯 Max profit ₹${trade.maxProfit} meets 2% target (₹${r2(target2Pct)} on ₹${r2(capital)})`);
  } else {
    const lotsNeeded = Math.ceil(target2Pct / (trade.maxProfit || 1));
    trade.rationale.push(`📊 Need ${lotsNeeded} lot(s) for 2% target (₹${r2(target2Pct)})`);
  }
}

// ══════════════════════════════════════════════
//  Bias Determination
// ══════════════════════════════════════════════

function determineBias(
  tech: TechnicalSnapshot,
  ind: MarketIndicators,
): { bias: "BULLISH" | "BEARISH" | "NEUTRAL"; biasStrength: number } {
  let bullPoints = 0;
  let bearPoints = 0;

  // ── Price trend (VWAP/SMA) — same as "Trend" pill; heavy weight so bias matches chart
  if (ind.trend === "trend-up") {
    bullPoints += 24;
  } else if (ind.trend === "trend-down") {
    bearPoints += 24;
  } else {
    bullPoints += 5;
    bearPoints += 5;
  }
  if (ind.trend === "trend-up" && ind.trendStrength > 50) {
    bullPoints += Math.round((ind.trendStrength - 50) * 0.25);
  }
  if (ind.trend === "trend-down" && ind.trendStrength > 50) {
    bearPoints += Math.round((ind.trendStrength - 50) * 0.25);
  }

  // ── Session: spot vs previous close (bear days no longer get overridden by ST alone)
  const d = ind.spotChangePct;
  if (d < -0.2) {
    bearPoints += 22;
  } else if (d < -0.05) {
    bearPoints += 12;
  } else if (d > 0.2) {
    bullPoints += 22;
  } else if (d > 0.05) {
    bullPoints += 12;
  }

  // When the chart trend is down, do not let a single short-term signal flip the desk to "bull" easily
  const trendDown = ind.trend === "trend-down";
  const trendUp = ind.trend === "trend-up";
  const stBull = tech.superTrendSignal === "BUY";
  const stBear = !stBull;
  if (trendDown && stBull) {
    bullPoints += 4;
  } else if (trendUp && stBear) {
    bearPoints += 4;
  } else {
    if (stBull) bullPoints += 12;
    else bearPoints += 12;
  }

  if (trendDown && tech.emaCrossover === "BULLISH") {
    bullPoints += 5;
  } else if (trendUp && tech.emaCrossover === "BEARISH") {
    bearPoints += 5;
  } else {
    if (tech.emaCrossover === "BULLISH") bullPoints += 12;
    else if (tech.emaCrossover === "BEARISH") bearPoints += 12;
  }

  if (trendDown && tech.priceVsVwap === "ABOVE") {
    bullPoints += 4; // dead-cat: above VWAP but structurally down
  } else if (trendUp && tech.priceVsVwap === "BELOW") {
    bearPoints += 4;
  } else {
    if (tech.priceVsVwap === "ABOVE") bullPoints += 8;
    else if (tech.priceVsVwap === "BELOW") bearPoints += 8;
  }

  if (tech.rsi > 60) bullPoints += 6;
  else if (tech.rsi < 40) bearPoints += 6;

  if (tech.momentum > 0.3) bullPoints += 5;
  else if (tech.momentum < -0.3) bearPoints += 5;

  if (ind.pcr > 1.1) bullPoints += 4;
  else if (ind.pcr < 0.8) bearPoints += 4;

  const total = Math.max(1, bullPoints + bearPoints);
  const bullPct = (bullPoints / total) * 100;
  const bearPct = (bearPoints / total) * 100;
  const diff = Math.abs(bullPct - bearPct);

  if (diff < 10) {
    return { bias: "NEUTRAL", biasStrength: Math.round(50) };
  }
  if (bullPoints > bearPoints) {
    return { bias: "BULLISH", biasStrength: Math.round(bullPct) };
  }
  if (bearPoints > bullPoints) {
    return { bias: "BEARISH", biasStrength: Math.round(bearPct) };
  }
  return { bias: "NEUTRAL", biasStrength: 50 };
}

// ══════════════════════════════════════════════
//  Helpers
// ══════════════════════════════════════════════

function scripFromLeg(row: OptionChainRow | undefined): number | undefined {
  if (!row?.scripCode) return undefined;
  const n = parseInt(String(row.scripCode).replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function findStrike(chain: OptionChainStrike[], strike: number): OptionChainStrike | undefined {
  return chain.find((s) => s.strike === strike);
}

function findMaxOI(chain: OptionChainStrike[], side: "ce" | "pe"): { strike: number; oi: number } {
  let maxOI = 0;
  let maxStrike = 0;
  for (const s of chain) {
    const oi = s[side].oi;
    if (oi > maxOI) { maxOI = oi; maxStrike = s.strike; }
  }
  return { strike: maxStrike, oi: maxOI };
}

function estimateMargin(spot: number, premium: number, type: string, lotSize: number): number {
  // SPAN margin approximation for NIFTY options
  // Naked sell: ~15-20% of (spot × lotSize) + premium received
  // Spread: max loss
  if (type === "sell") {
    return r2(spot * lotSize * 0.15);
  }
  if (type === "strangle") {
    return r2(spot * lotSize * 0.18); // higher for strangle
  }
  return r2(premium * lotSize); // buy = premium paid
}

function emptyScanResult(spot: number, ind: MarketIndicators, tech: TechnicalSnapshot): ScanResult {
  const pro = EMPTY_PRO;
  const fii = null;
  const proSignal = buildProTradeSignal(null, ind, tech, spot, pro, fii);
  const tradingAlgo = buildScanTradingAlgo({
    bestTrade: null,
    proSignal,
    marketContext: { spot, vix: ind.vix, expectedMove: 0, daysToExpiry: ind.daysToExpiry },
  });
  return {
    bestTrade: null,
    alternates: [],
    topCreditStrategies: [],
    marketBias: "NEUTRAL",
    biasStrength: 0,
    scanTimestamp: new Date().toISOString(),
    marketContext: {
      spot,
      spotChange: ind.spotChange,
      spotChangePct: ind.spotChangePct,
      vix: ind.vix,
      pcr: ind.pcr,
      trend: ind.trend,
      trendStrength: ind.trendStrength,
      ivPercentile: ind.ivPercentile,
      maxCallOI: { strike: 0, oi: 0 },
      maxPutOI: { strike: 0, oi: 0 },
      atmIV: 0,
      atmStraddle: 0,
      expectedMove: 0,
      daysToExpiry: ind.daysToExpiry,
    },
    professionalIndicators: pro,
    fiiDii: fii,
    proSignal,
    tradingAlgo,
  };
}

function genId(): string {
  return `scan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatLakh(n: number): string {
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(1)}Cr`;
  if (n >= 100_000) return `${(n / 100_000).toFixed(1)}L`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}
