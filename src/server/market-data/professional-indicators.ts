/**
 * Professional-style derived metrics from OHLC + options chain.
 * Used by the Pro Auto-Scanner desk (not a substitute for terminal data).
 */

import type { OHLCBar } from "@/types/market";
import type { OptionChainStrike } from "@/types/market";
import { computeOiInsights, type OiInsights } from "./oi-insights";

export interface MacdSnapshot {
  macd: number;
  signal: number;
  histogram: number;
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
}

export interface BollingerSnapshot {
  upper: number;
  middle: number;
  lower: number;
  percentB: number;
  widthPct: number;
  position: "ABOVE_UPPER" | "UPPER_HALF" | "LOWER_HALF" | "BELOW_LOWER";
}

export interface StochasticSnapshot {
  k: number;
  d: number;
  zone: "OVERBOUGHT" | "OVERSOLD" | "NEUTRAL";
}

export interface ChainProSnapshot {
  maxPain: number;
  totalCallOI: number;
  totalPutOI: number;
  totalCallVol: number;
  totalPutVol: number;
  pcrOI: number;
  pcrVolume: number;
  ivSkewATM: number;
}

export interface ProfessionalIndicatorBundle {
  macd: MacdSnapshot | null;
  bollinger: BollingerSnapshot | null;
  stochastic: StochasticSnapshot | null;
  chain: ChainProSnapshot | null;
  oiInsights: OiInsights | null;
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emaSeries(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out.push(prev);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function lastEMACloses(closes: number[], period: number): number {
  const s = emaSeries(closes, period);
  return s.length ? s[s.length - 1] : closes[closes.length - 1] ?? 0;
}

/**
 * Standard MACD(12,26) line and signal(9) on closing prices.
 */
export function computeMACD(closes: number[]): MacdSnapshot | null {
  if (closes.length < 35) return null;
  const macdLine: number[] = [];
  for (let i = 26; i < closes.length; i++) {
    const sl = closes.slice(0, i + 1);
    const m12 = lastEMACloses(sl, 12);
    const m26 = lastEMACloses(sl, 26);
    macdLine.push(m12 - m26);
  }
  if (macdLine.length < 9) return null;
  const macd = r2(macdLine[macdLine.length - 1]);
  const sig = emaSeries(macdLine, 9);
  const signal = r2(sig.length ? sig[sig.length - 1] : macd);
  const histogram = r2(macd - signal);
  const bias: MacdSnapshot["bias"] =
    histogram > 0.1 ? "BULLISH" : histogram < -0.1 ? "BEARISH" : "NEUTRAL";
  return { macd, signal, histogram, bias };
}

export function computeBollinger(
  closes: number[],
  period = 20,
  mult = 2,
): BollingerSnapshot | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance =
    slice.reduce((a, b) => a + (b - middle) ** 2, 0) / period;
  const std = Math.sqrt(variance);
  const upper = middle + mult * std;
  const lower = middle - mult * std;
  const last = closes[closes.length - 1];
  const percentB = upper - lower > 0 ? (last - lower) / (upper - lower) : 0.5;
  const widthPct = middle > 0 ? ((upper - lower) / middle) * 100 : 0;
  let position: BollingerSnapshot["position"] = "UPPER_HALF";
  if (last >= upper) position = "ABOVE_UPPER";
  else if (last <= lower) position = "BELOW_LOWER";
  else if (percentB > 0.55) position = "UPPER_HALF";
  else if (percentB < 0.45) position = "LOWER_HALF";
  return {
    upper: r2(upper),
    middle: r2(middle),
    lower: r2(lower),
    percentB: r2(percentB),
    widthPct: r2(widthPct),
    position,
  };
}

export function computeStochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  kPeriod = 14,
  dSmooth = 3,
): StochasticSnapshot | null {
  if (closes.length < kPeriod + dSmooth) return null;
  const rawK: number[] = [];
  for (let i = kPeriod - 1; i < closes.length; i++) {
    const hh = Math.max(...highs.slice(i - kPeriod + 1, i + 1));
    const ll = Math.min(...lows.slice(i - kPeriod + 1, i + 1));
    const c = closes[i];
    const k = hh - ll < 1e-9 ? 50 : ((c - ll) / (hh - ll)) * 100;
    rawK.push(k);
  }
  const kLast = rawK[rawK.length - 1] ?? 50;
  const d =
    rawK.length >= dSmooth
      ? rawK.slice(-dSmooth).reduce((a, b) => a + b, 0) / dSmooth
      : kLast;
  const kk = r2(kLast);
  const dd = r2(d);
  const zone: StochasticSnapshot["zone"] =
    kk > 80 ? "OVERBOUGHT" : kk < 20 ? "OVERSOLD" : "NEUTRAL";
  return { k: kk, d: dd, zone };
}

/**
 * Max pain: strike that minimizes total intrinsic (writer-friendly pin).
 */
export function computeMaxPain(strikes: OptionChainStrike[]): number {
  if (strikes.length === 0) return 0;
  const levels = strikes.map((s) => s.strike).filter(Boolean);
  const uniq = levels
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort((a, b) => a - b);
  let minSum = Infinity;
  let best = uniq[Math.floor(uniq.length / 2)] ?? 0;
  for (const X of uniq) {
    let sum = 0;
    for (const row of strikes) {
      const ce = Math.max(0, X - row.strike) * row.ce.oi;
      const pe = Math.max(0, row.strike - X) * row.pe.oi;
      sum += ce + pe;
    }
    if (sum < minSum) {
      minSum = sum;
      best = X;
    }
  }
  return best;
}

export function computeChainProSnapshot(
  strikes: OptionChainStrike[],
  atmStrike: number,
): ChainProSnapshot | null {
  if (strikes.length === 0) return null;
  let tco = 0, tpu = 0, tcv = 0, tpv = 0;
  for (const s of strikes) {
    tco += s.ce.oi;
    tpu += s.pe.oi;
    tcv += s.ce.volume;
    tpv += s.pe.volume;
  }
  const pcrOI = tco > 0 ? tpu / tco : 0;
  const pcrVolume = tcv > 0 ? tpv / tcv : 0;
  const row = strikes.find((s) => s.strike === atmStrike) ?? strikes[Math.floor(strikes.length / 2)];
  const ivSkewATM = (row?.ce.iv ?? 0) - (row?.pe.iv ?? 0);
  return {
    maxPain: computeMaxPain(strikes),
    totalCallOI: tco,
    totalPutOI: tpu,
    totalCallVol: tcv,
    totalPutVol: tpv,
    pcrOI: r2(pcrOI),
    pcrVolume: r2(pcrVolume),
    ivSkewATM: r2(ivSkewATM),
  };
}

export function buildProfessionalBundle(
  bars: OHLCBar[],
  strikes: OptionChainStrike[],
  atmStrike: number,
): ProfessionalIndicatorBundle {
  if (bars.length < 5) {
    return {
      macd: null,
      bollinger: null,
      stochastic: null,
      chain: strikes.length ? computeChainProSnapshot(strikes, atmStrike) : null,
      oiInsights: strikes.length ? computeOiInsights(strikes) : null,
    };
  }
  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  return {
    macd: computeMACD(closes),
    bollinger: computeBollinger(closes, 20, 2),
    stochastic: computeStochastic(highs, lows, closes, 14, 3),
    chain: computeChainProSnapshot(strikes, atmStrike),
    oiInsights: computeOiInsights(strikes),
  };
}
