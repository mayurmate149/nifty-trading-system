/**
 * ═══════════════════════════════════════════════════════════════════
 * NIFTY TRADING SIMULATOR — Mock Data Generators
 * ═══════════════════════════════════════════════════════════════════
 *
 * Generates realistic Nifty / BankNifty market data:
 *   - Spot prices with random walk
 *   - Options chains with strikes, IV, OI, Greeks
 *   - Positions, Order book, Margin
 *   - WebSocket tick data
 */

// ─── Helpers ─────────────────────────────────

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

function roundTo(n, decimals = 2) {
  return Math.round(n * 10 ** decimals) / 10 ** decimals;
}

function generateOrderId() {
  return `SIM${Date.now()}${randInt(1000, 9999)}`;
}

// ─── Spot Price Engine ───────────────────────

class SpotPriceEngine {
  constructor(symbol, basePrice, volatility = 0.0005) {
    this.symbol = symbol;
    this.price = basePrice;
    this.basePrice = basePrice;
    this.volatility = volatility;
    this.trend = 0; // -1 bearish, 0 neutral, +1 bullish
    this.history = [];
  }

  tick() {
    const drift = this.trend * 0.0001;
    const change = drift + (Math.random() - 0.5) * 2 * this.volatility * this.price;
    this.price = roundTo(this.price + change, 2);

    // Keep within ±3% of base to prevent drift too far
    const maxDeviation = this.basePrice * 0.03;
    if (this.price > this.basePrice + maxDeviation) this.price = this.basePrice + maxDeviation;
    if (this.price < this.basePrice - maxDeviation) this.price = this.basePrice - maxDeviation;

    this.history.push({ price: this.price, time: Date.now() });
    if (this.history.length > 5000) this.history.shift();

    return this.price;
  }

  setTrend(trend) {
    this.trend = trend; // -1, 0, +1
  }

  setVolatility(vol) {
    this.volatility = vol;
  }

  spike(percent) {
    this.price = roundTo(this.price * (1 + percent / 100), 2);
  }
}

// ─── Options Pricing (simplified Black-Scholes-ish) ────

function calcOptionPrice(spot, strike, iv, daysToExpiry, type) {
  const T = Math.max(daysToExpiry / 365, 0.001);
  const intrinsic =
    type === "CE"
      ? Math.max(0, spot - strike)
      : Math.max(0, strike - spot);

  const timeValue = spot * iv * Math.sqrt(T) * 0.4;
  const otmPenalty = Math.exp(-Math.abs(spot - strike) / spot * 5);

  return roundTo(Math.max(intrinsic + timeValue * otmPenalty, 0.05), 2);
}

function calcGreeks(spot, strike, iv, daysToExpiry, type) {
  const T = Math.max(daysToExpiry / 365, 0.001);
  const moneyness = (spot - strike) / spot;

  const delta = type === "CE"
    ? roundTo(0.5 + moneyness * 3 * Math.min(1, 1 / Math.sqrt(T)), 4)
    : roundTo(-0.5 + moneyness * 3 * Math.min(1, 1 / Math.sqrt(T)), 4);

  const gamma = roundTo(Math.exp(-moneyness * moneyness * 10) * 0.01 / Math.sqrt(T), 6);
  const theta = roundTo(-spot * iv * 0.5 / (365 * Math.sqrt(T)) * Math.exp(-moneyness * moneyness * 5), 2);
  const vega = roundTo(spot * Math.sqrt(T) * 0.01 * Math.exp(-moneyness * moneyness * 5), 2);

  return { delta: Math.max(-1, Math.min(1, delta)), gamma, theta, vega };
}

// ─── Generate Strikes ────────────────────────

function generateStrikes(spot, step, count) {
  const atm = Math.round(spot / step) * step;
  const strikes = [];
  for (let i = -count; i <= count; i++) {
    strikes.push(atm + i * step);
  }
  return strikes;
}

// ─── Options Chain Generator ─────────────────

function generateOptionsChain(spot, strikes, baseIV, daysToExpiry) {
  return strikes.map((strike) => {
    const moneyness = Math.abs(spot - strike) / spot;
    // IV smile: higher IV for OTM options
    const ivSmile = baseIV + moneyness * 0.15 + rand(-0.01, 0.01);

    const cePrice = calcOptionPrice(spot, strike, ivSmile, daysToExpiry, "CE");
    const pePrice = calcOptionPrice(spot, strike, ivSmile, daysToExpiry, "PE");
    const ceGreeks = calcGreeks(spot, strike, ivSmile, daysToExpiry, "CE");
    const peGreeks = calcGreeks(spot, strike, ivSmile, daysToExpiry, "PE");

    // OI: higher near ATM, decreasing as you go OTM
    const oiFactor = Math.exp(-moneyness * moneyness * 50);
    const ceOI = randInt(50000, 500000) * oiFactor;
    const peOI = randInt(50000, 500000) * oiFactor;

    return {
      strike,
      ce: {
        ltp: cePrice,
        iv: roundTo(ivSmile * 100, 2),
        oi: Math.round(ceOI),
        changeInOi: randInt(-20000, 20000),
        volume: randInt(1000, 50000),
        bidPrice: roundTo(cePrice - rand(0.05, 0.5), 2),
        askPrice: roundTo(cePrice + rand(0.05, 0.5), 2),
        ...ceGreeks,
      },
      pe: {
        ltp: pePrice,
        iv: roundTo(ivSmile * 100, 2),
        oi: Math.round(peOI),
        changeInOi: randInt(-20000, 20000),
        volume: randInt(1000, 50000),
        bidPrice: roundTo(pePrice - rand(0.05, 0.5), 2),
        askPrice: roundTo(pePrice + rand(0.05, 0.5), 2),
        ...peGreeks,
      },
    };
  });
}

// ─── Exports ─────────────────────────────────

module.exports = {
  rand,
  randInt,
  roundTo,
  generateOrderId,
  SpotPriceEngine,
  calcOptionPrice,
  calcGreeks,
  generateStrikes,
  generateOptionsChain,
};
