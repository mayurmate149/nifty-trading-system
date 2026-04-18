/**
 * AI Scalp Signal Engine
 *
 * Multi-factor weighted scoring model that produces:
 *   BUY_CE  — go long call (bullish scalp)
 *   BUY_PE  — go long put  (bearish scalp)
 *   SELL_CE — short call   (bearish premium sell)
 *   SELL_PE — short put    (bullish premium sell)
 *   NO_TRADE — conflicting signals / low confidence
 *
 * ─── Scoring Factors (total weight = 100) ───
 *
 *   1. EMA Crossover (9/21)         → 15 pts  (trend direction)
 *   2. RSI                          → 12 pts  (overbought/oversold)
 *   3. VWAP Position                → 10 pts  (institutional bias)
 *   4. SuperTrend                   → 15 pts  (trend confirmation)
 *   5. Momentum (ROC)               → 8 pts   (acceleration)
 *   6. OI Change / Max OI Walls     → 12 pts  (smart money positioning)
 *   7. PCR                          → 8 pts   (sentiment)
 *   8. IV Percentile                → 5 pts   (premium richness)
 *   9. Support / Resistance         → 10 pts  (proximity to barriers)
 *  10. Volume Spike + Candle        → 5 pts   (confirmation)
 *
 * Direction determined first, then BUY vs SELL decided by IV level:
 *   High IV → prefer SELL (collect premium, IV crush)
 *   Low IV  → prefer BUY  (cheap premium)
 */

import { TechnicalSnapshot } from "@/server/market-data/technicals";
import { MarketIndicators, OptionChainStrike } from "@/types/market";

// ─── Signal Types ────────────────────────────

export type ScalpAction = "BUY_CE" | "BUY_PE" | "SELL_CE" | "SELL_PE" | "NO_TRADE";

export interface ScalpSignal {
  action: ScalpAction;
  confidence: number;       // 0-100
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  strike: number;           // recommended strike
  premium: number;          // LTP at that strike
  stopLoss: number;         // suggested SL on the option premium
  target: number;           // suggested target premium
  atrSL: number;            // ATR-based Nifty SL points
  factors: SignalFactor[];   // individual factor scores
  rationale: string[];       // human-readable reasons
  timestamp: string;
}

export interface SignalFactor {
  name: string;
  weight: number;
  score: number;        // actual score achieved (can be negative for contra)
  direction: "BULL" | "BEAR" | "NEUTRAL";
  detail: string;
}

// ─── Input ───────────────────────────────────

export interface ScalpAIInput {
  technicals: TechnicalSnapshot;
  indicators: MarketIndicators;
  chain: OptionChainStrike[];
  spot: number;
  lotSize: number;
}

// ─── Main Signal Generator ───────────────────

export function generateScalpSignal(input: ScalpAIInput): ScalpSignal {
  const { technicals: tech, indicators: ind, chain, spot, lotSize } = input;
  const factors: SignalFactor[] = [];
  const rationale: string[] = [];

  let bullScore = 0;
  let bearScore = 0;

  // ─────────────────────────────────────────────
  // Factor 1: EMA Crossover (15 pts)
  // ─────────────────────────────────────────────
  {
    const weight = 15;
    if (tech.emaCrossover === "BULLISH") {
      bullScore += weight;
      factors.push({ name: "EMA 9/21", weight, score: weight, direction: "BULL", detail: `EMA9 ${tech.ema9.toFixed(0)} > EMA21 ${tech.ema21.toFixed(0)}` });
      rationale.push(`📈 EMA9 above EMA21 — bullish crossover`);
    } else if (tech.emaCrossover === "BEARISH") {
      bearScore += weight;
      factors.push({ name: "EMA 9/21", weight, score: weight, direction: "BEAR", detail: `EMA9 ${tech.ema9.toFixed(0)} < EMA21 ${tech.ema21.toFixed(0)}` });
      rationale.push(`📉 EMA9 below EMA21 — bearish crossover`);
    } else {
      factors.push({ name: "EMA 9/21", weight, score: 0, direction: "NEUTRAL", detail: "EMAs flat — no crossover" });
    }
  }

  // ─────────────────────────────────────────────
  // Factor 2: RSI (12 pts)
  // ─────────────────────────────────────────────
  {
    const weight = 12;
    const rsi = tech.rsi;
    if (rsi >= 60 && rsi < 75) {
      bullScore += weight;
      factors.push({ name: "RSI", weight, score: weight, direction: "BULL", detail: `RSI ${rsi.toFixed(1)} — bullish momentum` });
      rationale.push(`RSI ${rsi.toFixed(1)} — bullish zone`);
    } else if (rsi >= 75) {
      // Overbought → contrarian bearish for sellers
      bearScore += weight * 0.7;
      factors.push({ name: "RSI", weight, score: Math.round(weight * 0.7), direction: "BEAR", detail: `RSI ${rsi.toFixed(1)} — overbought, reversal likely` });
      rationale.push(`⚠️ RSI ${rsi.toFixed(1)} — overbought, potential sell signal`);
    } else if (rsi <= 40 && rsi > 25) {
      bearScore += weight;
      factors.push({ name: "RSI", weight, score: weight, direction: "BEAR", detail: `RSI ${rsi.toFixed(1)} — bearish momentum` });
      rationale.push(`RSI ${rsi.toFixed(1)} — bearish zone`);
    } else if (rsi <= 25) {
      // Oversold → contrarian bullish for sellers
      bullScore += weight * 0.7;
      factors.push({ name: "RSI", weight, score: Math.round(weight * 0.7), direction: "BULL", detail: `RSI ${rsi.toFixed(1)} — oversold, bounce likely` });
      rationale.push(`⚠️ RSI ${rsi.toFixed(1)} — oversold, potential buy signal`);
    } else {
      // 40-60 neutral zone
      factors.push({ name: "RSI", weight, score: 0, direction: "NEUTRAL", detail: `RSI ${rsi.toFixed(1)} — neutral zone` });
    }
  }

  // ─────────────────────────────────────────────
  // Factor 3: VWAP Position (10 pts)
  // ─────────────────────────────────────────────
  {
    const weight = 10;
    if (tech.priceVsVwap === "ABOVE") {
      bullScore += weight;
      factors.push({ name: "VWAP", weight, score: weight, direction: "BULL", detail: `Price ${tech.close.toFixed(0)} above VWAP ${tech.vwap.toFixed(0)}` });
      rationale.push(`Price above VWAP ${tech.vwap.toFixed(0)} — buyers in control`);
    } else if (tech.priceVsVwap === "BELOW") {
      bearScore += weight;
      factors.push({ name: "VWAP", weight, score: weight, direction: "BEAR", detail: `Price ${tech.close.toFixed(0)} below VWAP ${tech.vwap.toFixed(0)}` });
      rationale.push(`Price below VWAP ${tech.vwap.toFixed(0)} — sellers in control`);
    } else {
      factors.push({ name: "VWAP", weight, score: 0, direction: "NEUTRAL", detail: "Price at VWAP — no edge" });
    }
  }

  // ─────────────────────────────────────────────
  // Factor 4: SuperTrend (15 pts)
  // ─────────────────────────────────────────────
  {
    const weight = 15;
    if (tech.superTrendSignal === "BUY") {
      bullScore += weight;
      factors.push({ name: "SuperTrend", weight, score: weight, direction: "BULL", detail: `SuperTrend ${tech.superTrend.toFixed(0)} — BUY signal` });
      rationale.push(`SuperTrend BUY — trend is up, ST at ${tech.superTrend.toFixed(0)}`);
    } else {
      bearScore += weight;
      factors.push({ name: "SuperTrend", weight, score: weight, direction: "BEAR", detail: `SuperTrend ${tech.superTrend.toFixed(0)} — SELL signal` });
      rationale.push(`SuperTrend SELL — trend is down, ST at ${tech.superTrend.toFixed(0)}`);
    }
  }

  // ─────────────────────────────────────────────
  // Factor 5: Momentum / ROC (8 pts)
  // ─────────────────────────────────────────────
  {
    const weight = 8;
    const mom = tech.momentum;
    if (mom > 0.15) {
      bullScore += weight;
      factors.push({ name: "Momentum", weight, score: weight, direction: "BULL", detail: `ROC ${mom.toFixed(2)}% — positive acceleration` });
    } else if (mom < -0.15) {
      bearScore += weight;
      factors.push({ name: "Momentum", weight, score: weight, direction: "BEAR", detail: `ROC ${mom.toFixed(2)}% — negative acceleration` });
    } else {
      factors.push({ name: "Momentum", weight, score: 0, direction: "NEUTRAL", detail: `ROC ${mom.toFixed(2)}% — flat` });
    }
  }

  // ─────────────────────────────────────────────
  // Factor 6: OI Analysis (12 pts)
  // ─────────────────────────────────────────────
  {
    const weight = 12;
    const oiResult = analyzeOI(chain, spot);
    if (oiResult.bias === "BULL") {
      bullScore += weight;
      factors.push({ name: "OI Analysis", weight, score: weight, direction: "BULL", detail: oiResult.detail });
      rationale.push(`OI: ${oiResult.detail}`);
    } else if (oiResult.bias === "BEAR") {
      bearScore += weight;
      factors.push({ name: "OI Analysis", weight, score: weight, direction: "BEAR", detail: oiResult.detail });
      rationale.push(`OI: ${oiResult.detail}`);
    } else {
      factors.push({ name: "OI Analysis", weight, score: 0, direction: "NEUTRAL", detail: oiResult.detail });
    }
  }

  // ─────────────────────────────────────────────
  // Factor 7: PCR (8 pts)
  // ─────────────────────────────────────────────
  {
    const weight = 8;
    const pcr = ind.pcr;
    if (pcr > 1.2) {
      bullScore += weight;
      factors.push({ name: "PCR", weight, score: weight, direction: "BULL", detail: `PCR ${pcr.toFixed(2)} — high put writing, bullish` });
      rationale.push(`PCR ${pcr.toFixed(2)} — heavy put writing supports bulls`);
    } else if (pcr < 0.7) {
      bearScore += weight;
      factors.push({ name: "PCR", weight, score: weight, direction: "BEAR", detail: `PCR ${pcr.toFixed(2)} — heavy call writing, bearish` });
      rationale.push(`PCR ${pcr.toFixed(2)} — heavy call writing supports bears`);
    } else {
      factors.push({ name: "PCR", weight, score: 0, direction: "NEUTRAL", detail: `PCR ${pcr.toFixed(2)} — balanced` });
    }
  }

  // ─────────────────────────────────────────────
  // Factor 8: IV Percentile (5 pts)
  // ─────────────────────────────────────────────
  {
    const weight = 5;
    // For seller: high IV is positive (rich premiums)
    if (ind.ivPercentile >= 50) {
      factors.push({ name: "IV%ile", weight, score: weight, direction: "NEUTRAL", detail: `IV%ile ${ind.ivPercentile}% — rich premiums, favor SELL` });
      rationale.push(`IV%ile ${ind.ivPercentile}% — premium rich, sell-side favored`);
    } else if (ind.ivPercentile <= 25) {
      factors.push({ name: "IV%ile", weight, score: weight, direction: "NEUTRAL", detail: `IV%ile ${ind.ivPercentile}% — cheap, favor BUY` });
      rationale.push(`IV%ile ${ind.ivPercentile}% — cheap premiums, buy-side favored`);
    } else {
      factors.push({ name: "IV%ile", weight, score: 2, direction: "NEUTRAL", detail: `IV%ile ${ind.ivPercentile}% — fair` });
    }
  }

  // ─────────────────────────────────────────────
  // Factor 9: Support / Resistance Proximity (10 pts)
  // ─────────────────────────────────────────────
  {
    const weight = 10;
    const srResult = analyzeSR(spot, ind.support, ind.resistance, ind.pivotPoint);
    if (srResult.bias === "BULL") {
      bullScore += weight;
      factors.push({ name: "S/R Proximity", weight, score: weight, direction: "BULL", detail: srResult.detail });
      rationale.push(srResult.detail);
    } else if (srResult.bias === "BEAR") {
      bearScore += weight;
      factors.push({ name: "S/R Proximity", weight, score: weight, direction: "BEAR", detail: srResult.detail });
      rationale.push(srResult.detail);
    } else {
      factors.push({ name: "S/R Proximity", weight, score: 0, direction: "NEUTRAL", detail: srResult.detail });
    }
  }

  // ─────────────────────────────────────────────
  // Factor 10: Volume Spike + Candle (5 pts)
  // ─────────────────────────────────────────────
  {
    const weight = 5;
    if (tech.volumeSpike && tech.lastCandleBullish && tech.candleBodyRatio > 0.6) {
      bullScore += weight;
      factors.push({ name: "Vol+Candle", weight, score: weight, direction: "BULL", detail: "Volume spike + bullish marubozu" });
      rationale.push("🔥 Volume spike with strong bullish candle");
    } else if (tech.volumeSpike && !tech.lastCandleBullish && tech.candleBodyRatio > 0.6) {
      bearScore += weight;
      factors.push({ name: "Vol+Candle", weight, score: weight, direction: "BEAR", detail: "Volume spike + bearish marubozu" });
      rationale.push("🔥 Volume spike with strong bearish candle");
    } else if (tech.volumeSpike) {
      const dir = tech.lastCandleBullish ? "BULL" : "BEAR";
      if (dir === "BULL") bullScore += weight * 0.5;
      else bearScore += weight * 0.5;
      factors.push({ name: "Vol+Candle", weight, score: Math.round(weight * 0.5), direction: dir, detail: `Volume spike, ${tech.lastCandleBullish ? "bullish" : "bearish"} candle (weak body)` });
    } else {
      factors.push({ name: "Vol+Candle", weight, score: 0, direction: "NEUTRAL", detail: "No volume spike" });
    }
  }

  // ─────────────────────────────────────────────
  // DECISION: Determine direction and action
  // ─────────────────────────────────────────────

  const netScore = bullScore - bearScore;
  const totalActive = bullScore + bearScore;
  const confidence = totalActive > 0
    ? Math.round((Math.abs(netScore) / totalActive) * 100)
    : 0;

  // Need at least 15pts net difference and 30% confidence for a trade
  const MIN_NET = 15;
  const MIN_CONFIDENCE = 30;

  let direction: ScalpSignal["direction"];
  let action: ScalpAction;

  if (netScore >= MIN_NET && confidence >= MIN_CONFIDENCE) {
    direction = "BULLISH";
    // High IV → sell puts (collect premium), Low IV → buy calls (cheap)
    action = ind.ivPercentile >= 45 ? "SELL_PE" : "BUY_CE";
  } else if (netScore <= -MIN_NET && confidence >= MIN_CONFIDENCE) {
    direction = "BEARISH";
    // High IV → sell calls (collect premium), Low IV → buy puts (cheap)
    action = ind.ivPercentile >= 45 ? "SELL_CE" : "BUY_PE";
  } else {
    direction = "NEUTRAL";
    action = "NO_TRADE";
    rationale.push("⚠️ Conflicting signals — no clear edge, stay flat");
  }

  // ─────────────────────────────────────────────
  // Strike + Premium + SL/Target
  // ─────────────────────────────────────────────

  const atm = Math.round(spot / 50) * 50;
  const strikeInfo = pickStrike(chain, atm, action, tech.atr);

  return {
    action,
    confidence,
    direction,
    strike: strikeInfo.strike,
    premium: strikeInfo.premium,
    stopLoss: strikeInfo.sl,
    target: strikeInfo.target,
    atrSL: r2(tech.atr * 1.5),
    factors,
    rationale,
    timestamp: new Date().toISOString(),
  };
}

// ─── OI Analysis Helper ─────────────────────

function analyzeOI(
  chain: OptionChainStrike[],
  spot: number,
): { bias: "BULL" | "BEAR" | "NEUTRAL"; detail: string } {
  if (chain.length === 0) return { bias: "NEUTRAL", detail: "No OI data" };

  const atm = Math.round(spot / 50) * 50;

  // Find max call OI and max put OI strikes
  let maxCallOI = 0, maxCallStrike = atm;
  let maxPutOI = 0, maxPutStrike = atm;
  let atmCallChange = 0, atmPutChange = 0;

  for (const row of chain) {
    if (row.ce.oi > maxCallOI) { maxCallOI = row.ce.oi; maxCallStrike = row.strike; }
    if (row.pe.oi > maxPutOI) { maxPutOI = row.pe.oi; maxPutStrike = row.strike; }
    if (row.strike === atm) {
      atmCallChange = row.ce.changeInOi;
      atmPutChange = row.pe.changeInOi;
    }
  }

  // Max Call OI = resistance, Max Put OI = support
  const callWall = maxCallStrike;
  const putWall = maxPutStrike;
  const spotToCallWall = callWall - spot;
  const spotToPutWall = spot - putWall;

  // If more room to call wall → bullish bias, vice versa
  if (spotToCallWall > spotToPutWall * 1.3) {
    return {
      bias: "BULL",
      detail: `Put wall ${putWall} near, Call wall ${callWall} far — room to move up (ΔCall OI: ${fmtOI(atmCallChange)}, ΔPut OI: ${fmtOI(atmPutChange)})`,
    };
  } else if (spotToPutWall > spotToCallWall * 1.3) {
    return {
      bias: "BEAR",
      detail: `Call wall ${callWall} near, Put wall ${putWall} far — room to move down (ΔCall OI: ${fmtOI(atmCallChange)}, ΔPut OI: ${fmtOI(atmPutChange)})`,
    };
  }

  // Check OI change at ATM — put OI buildup = support = bullish
  if (atmPutChange > 0 && atmPutChange > atmCallChange * 1.5) {
    return { bias: "BULL", detail: `Heavy put writing at ATM ${atm} (ΔPut: +${fmtOI(atmPutChange)}) — support building` };
  }
  if (atmCallChange > 0 && atmCallChange > atmPutChange * 1.5) {
    return { bias: "BEAR", detail: `Heavy call writing at ATM ${atm} (ΔCall: +${fmtOI(atmCallChange)}) — resistance building` };
  }

  return { bias: "NEUTRAL", detail: `OI balanced — Call wall ${callWall}, Put wall ${putWall}` };
}

// ─── S/R Proximity Helper ────────────────────

function analyzeSR(
  spot: number,
  support: number[],
  resistance: number[],
  pivot: number,
): { bias: "BULL" | "BEAR" | "NEUTRAL"; detail: string } {
  const nearestSup = support.filter((s) => s < spot).sort((a, b) => b - a)[0] ?? 0;
  const nearestRes = resistance.filter((r) => r > spot).sort((a, b) => a - b)[0] ?? 0;

  const distToSup = nearestSup > 0 ? spot - nearestSup : 9999;
  const distToRes = nearestRes > 0 ? nearestRes - spot : 9999;

  // Price bouncing off support → bullish
  if (distToSup < 30) {
    return { bias: "BULL", detail: `Spot near support ${nearestSup} (${distToSup.toFixed(0)}pts away) — bounce zone` };
  }
  // Price hitting resistance → bearish
  if (distToRes < 30) {
    return { bias: "BEAR", detail: `Spot near resistance ${nearestRes} (${distToRes.toFixed(0)}pts away) — rejection zone` };
  }
  // Spot above pivot → bullish bias
  if (pivot > 0 && spot > pivot) {
    return { bias: "BULL", detail: `Spot above pivot ${pivot} — bullish bias` };
  }
  if (pivot > 0 && spot < pivot) {
    return { bias: "BEAR", detail: `Spot below pivot ${pivot} — bearish bias` };
  }

  return { bias: "NEUTRAL", detail: "Spot in no-man's land between S/R" };
}

// ─── Strike Picker ───────────────────────────

function pickStrike(
  chain: OptionChainStrike[],
  atm: number,
  action: ScalpAction,
  atr: number,
): { strike: number; premium: number; sl: number; target: number } {
  const STEP = 50;
  const empty = { strike: atm, premium: 0, sl: 0, target: 0 };

  if (action === "NO_TRADE") return empty;

  // For BUY_CE / SELL_PE → pick CE strikes
  // For BUY_PE / SELL_CE → pick PE strikes
  const isBullish = action === "BUY_CE" || action === "SELL_PE";
  const isSell = action === "SELL_CE" || action === "SELL_PE";

  let strike = atm;
  if (isSell) {
    // Sell OTM — 1-2 strikes away from ATM
    strike = isBullish ? atm - STEP : atm + STEP;
  }
  // For BUY, use ATM for maximum delta

  const row = chain.find((s) => s.strike === strike);
  if (!row) return { ...empty, strike };

  const opt = isBullish ? row.ce : row.pe;
  const premium = opt.ltp;

  if (isSell) {
    // Seller: target = 50% decay, SL = 2× premium
    return {
      strike,
      premium: r2(premium),
      sl: r2(premium * 2),       // exit if premium doubles against you
      target: r2(premium * 0.5), // exit when premium halves
    };
  } else {
    // Buyer: target = 40-50% gain, SL = 30% loss
    return {
      strike,
      premium: r2(premium),
      sl: r2(premium * 0.7),     // 30% SL
      target: r2(premium * 1.5), // 50% target
    };
  }
}

// ─── Utility ─────────────────────────────────

function fmtOI(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 10000000) return `${(n / 10000000).toFixed(1)}Cr`;
  if (abs >= 100000) return `${(n / 100000).toFixed(1)}L`;
  if (abs >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return `${n}`;
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}
