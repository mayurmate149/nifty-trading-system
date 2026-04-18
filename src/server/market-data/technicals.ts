/**
 * Technical Indicators Module
 *
 * Computes standard scalping indicators from OHLC bars:
 *   - RSI (14-period)
 *   - EMA 9 / EMA 21 (fast/slow crossover)
 *   - VWAP
 *   - ATR (14-period) for volatility-based SL
 *   - SuperTrend (10, 3)
 *   - Momentum (Rate of Change)
 *   - Candle Body Ratio (for pattern detection)
 */

import { OHLCBar } from "@/types/market";

// ─── Result Types ────────────────────────────

export interface TechnicalSnapshot {
  rsi: number;                    // 0-100
  ema9: number;
  ema21: number;
  emaCrossover: "BULLISH" | "BEARISH" | "NEUTRAL"; // 9 above/below 21
  vwap: number;
  priceVsVwap: "ABOVE" | "BELOW" | "AT";
  atr: number;                    // average true range (absolute ₹)
  superTrend: number;
  superTrendSignal: "BUY" | "SELL";
  momentum: number;               // rate of change % (5-bar)
  candleBodyRatio: number;        // 0-1 (1 = full body marubozu)
  lastCandleBullish: boolean;
  volumeSpike: boolean;           // last bar vol > 1.5× avg vol
  close: number;
  high: number;
  low: number;
}

// ─── Main Computation ────────────────────────

export function computeTechnicals(bars: OHLCBar[]): TechnicalSnapshot {
  if (bars.length < 5) {
    const c = bars.length > 0 ? bars[bars.length - 1].close : 0;
    return emptySnapshot(c);
  }

  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  const volumes = bars.map((b) => b.volume);
  const last = bars[bars.length - 1];

  // RSI
  const rsi = calcRSI(closes, 14);

  // EMA 9 & 21
  const ema9 = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  const emaCrossover: TechnicalSnapshot["emaCrossover"] =
    ema9 > ema21 * 1.0005 ? "BULLISH" :
    ema9 < ema21 * 0.9995 ? "BEARISH" : "NEUTRAL";

  // VWAP
  const vwap = calcVWAP(bars);
  const priceVsVwap: TechnicalSnapshot["priceVsVwap"] =
    last.close > vwap * 1.001 ? "ABOVE" :
    last.close < vwap * 0.999 ? "BELOW" : "AT";

  // ATR (14-period)
  const atr = calcATR(highs, lows, closes, 14);

  // SuperTrend (10, 3)
  const st = calcSuperTrend(highs, lows, closes, 10, 3);

  // Momentum — 5-bar rate of change
  const momentum = closes.length >= 6
    ? ((closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6]) * 100
    : 0;

  // Candle body ratio
  const bodySize = Math.abs(last.close - last.open);
  const candleRange = last.high - last.low;
  const candleBodyRatio = candleRange > 0 ? bodySize / candleRange : 0;
  const lastCandleBullish = last.close > last.open;

  // Volume spike — last bar volume > 1.5× rolling 10-bar average
  const avgVol = volumes.length >= 10
    ? volumes.slice(-10).reduce((a, b) => a + b, 0) / 10
    : volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const volumeSpike = last.volume > avgVol * 1.5;

  return {
    rsi: r2(rsi),
    ema9: r2(ema9),
    ema21: r2(ema21),
    emaCrossover,
    vwap: r2(vwap),
    priceVsVwap,
    atr: r2(atr),
    superTrend: r2(st.value),
    superTrendSignal: st.signal,
    momentum: r2(momentum),
    candleBodyRatio: r2(candleBodyRatio),
    lastCandleBullish,
    volumeSpike,
    close: last.close,
    high: last.high,
    low: last.low,
  };
}

// ─── RSI ─────────────────────────────────────

function calcRSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  // Initial average gain/loss
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  // Smooth RSI through remaining bars
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) {
      avgGain = (avgGain * (period - 1) + diff) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - diff) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ─── EMA ─────────────────────────────────────

function calcEMA(data: number[], period: number): number {
  if (data.length === 0) return 0;
  if (data.length < period) {
    return data.reduce((a, b) => a + b, 0) / data.length;
  }

  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }

  return ema;
}

// ─── VWAP ────────────────────────────────────

function calcVWAP(bars: OHLCBar[]): number {
  let cumulativeTPV = 0;
  let cumulativeVol = 0;

  for (const b of bars) {
    const tp = (b.high + b.low + b.close) / 3;
    cumulativeTPV += tp * b.volume;
    cumulativeVol += b.volume;
  }

  return cumulativeVol > 0 ? cumulativeTPV / cumulativeVol : bars[bars.length - 1].close;
}

// ─── ATR ─────────────────────────────────────

function calcATR(highs: number[], lows: number[], closes: number[], period: number): number {
  if (highs.length < 2) return 0;

  const trs: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
    trs.push(tr);
  }

  if (trs.length < period) {
    return trs.reduce((a, b) => a + b, 0) / trs.length;
  }

  // Wilder smoothing
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }

  return atr;
}

// ─── SuperTrend ──────────────────────────────

function calcSuperTrend(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number,
  multiplier: number,
): { value: number; signal: "BUY" | "SELL" } {
  const n = closes.length;
  if (n < period + 1) return { value: closes[n - 1], signal: "BUY" };

  // Compute ATR array
  const atrs: number[] = [0];
  for (let i = 1; i < n; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
    atrs.push(tr);
  }

  // Smooth ATR
  const smoothATR: number[] = new Array(n).fill(0);
  smoothATR[period] = atrs.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  for (let i = period + 1; i < n; i++) {
    smoothATR[i] = (smoothATR[i - 1] * (period - 1) + atrs[i]) / period;
  }

  // SuperTrend calculation
  const upperBand: number[] = new Array(n).fill(0);
  const lowerBand: number[] = new Array(n).fill(0);
  const superTrend: number[] = new Array(n).fill(0);
  const direction: number[] = new Array(n).fill(1); // 1 = up/buy, -1 = down/sell

  for (let i = period; i < n; i++) {
    const hl2 = (highs[i] + lows[i]) / 2;
    const basicUpper = hl2 + multiplier * smoothATR[i];
    const basicLower = hl2 - multiplier * smoothATR[i];

    upperBand[i] = basicUpper < upperBand[i - 1] || closes[i - 1] > upperBand[i - 1]
      ? basicUpper
      : upperBand[i - 1];

    lowerBand[i] = basicLower > lowerBand[i - 1] || closes[i - 1] < lowerBand[i - 1]
      ? basicLower
      : lowerBand[i - 1];

    if (i === period) {
      direction[i] = 1;
    } else if (superTrend[i - 1] === upperBand[i - 1]) {
      direction[i] = closes[i] > upperBand[i] ? 1 : -1;
    } else {
      direction[i] = closes[i] < lowerBand[i] ? -1 : 1;
    }

    superTrend[i] = direction[i] === 1 ? lowerBand[i] : upperBand[i];
  }

  const lastDir = direction[n - 1];
  return {
    value: superTrend[n - 1],
    signal: lastDir === 1 ? "BUY" : "SELL",
  };
}

// ─── Helpers ─────────────────────────────────

function emptySnapshot(close: number): TechnicalSnapshot {
  return {
    rsi: 50, ema9: close, ema21: close, emaCrossover: "NEUTRAL",
    vwap: close, priceVsVwap: "AT", atr: 0, superTrend: close,
    superTrendSignal: "BUY", momentum: 0, candleBodyRatio: 0,
    lastCandleBullish: true, volumeSpike: false,
    close, high: close, low: close,
  };
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}
