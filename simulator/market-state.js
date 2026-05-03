/**
 * ═══════════════════════════════════════════════════════════════════
 * NIFTY TRADING SIMULATOR — Market State Manager
 * ═══════════════════════════════════════════════════════════════════
 *
 * Central state for the simulated market:
 *   - Spot prices (Nifty, BankNifty)
 *   - Positions held by the simulated client
 *   - Order book with live status
 *   - Margin tracking
 *   - Scenario triggers
 */

const {
  SpotPriceEngine,
  generateStrikes,
  generateOptionsChain,
  roundTo,
  randInt,
  generateOrderId,
  calcOptionPrice,
} = require("./data-generators");

// ─── Configuration ───────────────────────────

const CLIENT_CODE = "58467591"; // Matches your real client code for seamless testing
const INITIAL_MARGIN = 500000;

// ─── Expiry Calculation ──────────────────────

function getNextThursday() {
  const d = new Date();
  const day = d.getDay();
  const diff = (4 - day + 7) % 7 || 7; // Next Thursday
  d.setDate(d.getDate() + diff);
  d.setHours(15, 30, 0, 0);
  return d;
}

function getDaysToExpiry() {
  const exp = getNextThursday();
  const now = new Date();
  return Math.max(0.1, (exp - now) / (1000 * 60 * 60 * 24));
}

function getExpiryString() {
  const exp = getNextThursday();
  return exp.toISOString().split("T")[0]; // YYYY-MM-DD
}

// ─── Market State ────────────────────────────

const state = {
  // Spot engines
  nifty: new SpotPriceEngine("NIFTY", 22500, 0.0003),
  bankNifty: new SpotPriceEngine("BANKNIFTY", 48200, 0.0004),

  // VIX
  vix: 13.5,
  baseIV: 0.14, // 14%

  // Positions (simulated open trades)
  positions: [],

  // Order book
  orders: [],

  // Margin
  margin: {
    AvailableMargin: INITIAL_MARGIN,
    UsedMargin: 0,
    NetMargin: INITIAL_MARGIN,
  },

  // WebSocket subscribers
  wsClients: new Set(),

  // Tick interval ref
  tickInterval: null,
  tickRate: 1000, // ms between ticks
};

// ─── Initialize Default Positions ────────────

function initDefaultPositions() {
  const spot = state.nifty.price;
  const atm = Math.round(spot / 50) * 50;

  state.positions = [
    {
      ScripCode: 100001,
      ScripName: `NIFTY ${getExpiryString()} ${atm - 200} CE`,
      Symbol: "NIFTY",
      OptionType: "CE",
      StrikeRate: atm - 200,
      BuySell: "S",
      NetQty: -50,
      AvgRate: calcOptionPrice(spot, atm - 200, state.baseIV, getDaysToExpiry(), "CE") + 5,
      LTP: 0, // updated on tick
      MTOM: 0,
      ExchOrderID: generateOrderId(),
    },
    {
      ScripCode: 100002,
      ScripName: `NIFTY ${getExpiryString()} ${atm + 200} CE`,
      Symbol: "NIFTY",
      OptionType: "CE",
      StrikeRate: atm + 200,
      BuySell: "B",
      NetQty: 50,
      AvgRate: calcOptionPrice(spot, atm + 200, state.baseIV, getDaysToExpiry(), "CE") - 2,
      LTP: 0,
      MTOM: 0,
      ExchOrderID: generateOrderId(),
    },
    {
      ScripCode: 100003,
      ScripName: `NIFTY ${getExpiryString()} ${atm + 100} PE`,
      Symbol: "NIFTY",
      OptionType: "PE",
      StrikeRate: atm + 100,
      BuySell: "S",
      NetQty: -50,
      AvgRate: calcOptionPrice(spot, atm + 100, state.baseIV, getDaysToExpiry(), "PE") + 3,
      LTP: 0,
      MTOM: 0,
      ExchOrderID: generateOrderId(),
    },
    {
      ScripCode: 100004,
      ScripName: `NIFTY ${getExpiryString()} ${atm + 300} PE`,
      Symbol: "NIFTY",
      OptionType: "PE",
      StrikeRate: atm + 300,
      BuySell: "B",
      NetQty: 50,
      AvgRate: calcOptionPrice(spot, atm + 300, state.baseIV, getDaysToExpiry(), "PE") - 1,
      LTP: 0,
      MTOM: 0,
      ExchOrderID: generateOrderId(),
    },
  ];

  // Create corresponding completed orders
  state.orders = state.positions.map((p) => ({
    ExchOrderID: p.ExchOrderID,
    ScripCode: p.ScripCode,
    ScripName: p.ScripName,
    BuySell: p.BuySell,
    Qty: Math.abs(p.NetQty),
    Rate: p.AvgRate,
    Status: "Fully Executed",
    OrderDateTime: new Date().toISOString(),
    AtMarket: "Y",
    Exchange: "N",
    ExchangeType: "D",
  }));

  // Calculate used margin
  const totalMarginUsed = state.positions
    .filter((p) => p.BuySell === "S")
    .reduce((sum, p) => sum + Math.abs(p.NetQty) * p.AvgRate * 5, 0); // Rough margin

  state.margin.UsedMargin = roundTo(totalMarginUsed, 2);
  state.margin.AvailableMargin = roundTo(INITIAL_MARGIN - totalMarginUsed, 2);
}

// ─── Update Position LTPs on every tick ──────

function updatePositionLTPs() {
  const spot = state.nifty.price;
  const dte = getDaysToExpiry();

  state.positions.forEach((pos) => {
    const optType = pos.OptionType;
    const strike = pos.StrikeRate;
    pos.LTP = calcOptionPrice(spot, strike, state.baseIV, dte, optType);
    pos.MTOM = roundTo((pos.LTP - pos.AvgRate) * pos.NetQty, 2);
  });
}

// ─── Tick Loop ───────────────────────────────

function startTickLoop() {
  if (state.tickInterval) clearInterval(state.tickInterval);

  state.tickInterval = setInterval(() => {
    // Advance spot prices
    const niftyPrice = state.nifty.tick();
    const bankNiftyPrice = state.bankNifty.tick();

    // Jitter VIX
    state.vix = roundTo(state.vix + (Math.random() - 0.5) * 0.1, 2);
    state.vix = Math.max(9, Math.min(30, state.vix));

    // Update position LTPs
    updatePositionLTPs();

    // Broadcast WebSocket ticks
    const ticks = [
      {
        symbol: "NIFTY",
        ltp: niftyPrice,
        volume: randInt(100000, 500000),
        oi: 0,
        timestamp: Date.now(),
        type: "INDEX",
      },
      {
        symbol: "BANKNIFTY",
        ltp: bankNiftyPrice,
        volume: randInt(50000, 200000),
        oi: 0,
        timestamp: Date.now(),
        type: "INDEX",
      },
    ];

    // Add option ticks for open positions
    state.positions.forEach((pos) => {
      ticks.push({
        symbol: pos.ScripName,
        scripCode: pos.ScripCode,
        ltp: pos.LTP,
        volume: randInt(5000, 50000),
        oi: randInt(100000, 500000),
        timestamp: Date.now(),
        type: "OPTION",
        optionType: pos.OptionType,
        strike: pos.StrikeRate,
      });
    });

    broadcastWS({ type: "tick", data: ticks });
  }, state.tickRate);
}

function stopTickLoop() {
  if (state.tickInterval) {
    clearInterval(state.tickInterval);
    state.tickInterval = null;
  }
}

// ─── WebSocket Broadcast ─────────────────────

function broadcastWS(message) {
  const json = JSON.stringify(message);
  for (const ws of state.wsClients) {
    if (ws.readyState === 1) {
      // WebSocket.OPEN
      ws.send(json);
    }
  }
}

// ─── Place Order (simulator) ─────────────────

function simulatePlaceOrder(body) {
  const orderId = generateOrderId();
  const spot = state.nifty.price;
  /** Normalize types so netting matches stored positions (avoids dup legs on exit). */
  const scripCode = Number(body.ScripCode);

  const order = {
    ExchOrderID: orderId,
    ScripCode: scripCode,
    ScripName: `NIFTY OPT ${scripCode}`,
    BuySell: body.BuySell,
    Qty: body.Qty,
    Rate: body.Price || spot,
    Status: "Fully Executed",
    OrderDateTime: new Date().toISOString(),
    AtMarket: body.AtMarket ? "Y" : "N",
    Exchange: body.Exchange || "N",
    ExchangeType: body.ExchangeType || "D",
  };

  state.orders.push(order);

  // Find existing position by ScripCode (regardless of side)
  // An exit order is the OPPOSITE side of the open position
  const existingIdx = state.positions.findIndex((p) => Number(p.ScripCode) === scripCode);

  if (existingIdx >= 0) {
    const existing = state.positions[existingIdx];
    // BUY adds to NetQty, SELL subtracts from NetQty
    const orderQty = Number(body.Qty ?? 0) * (body.BuySell === "B" ? 1 : -1);
    existing.NetQty = existing.NetQty + orderQty;

    console.log(
      `[SIM] Position ${existing.ScripName}: NetQty ${existing.NetQty} (${body.BuySell} ${body.Qty})`
    );

    // If NetQty is 0, position is closed — remove it
    if (existing.NetQty === 0) {
      console.log(`[SIM] Position ${existing.ScripName} CLOSED — removing`);
      state.positions.splice(existingIdx, 1);
    }
  } else {
    // New position
    state.positions.push({
      ScripCode: scripCode,
      ScripName: order.ScripName,
      Symbol: "NIFTY",
      OptionType: "CE",
      StrikeRate: 0,
      BuySell: body.BuySell,
      NetQty: body.BuySell === "B" ? Number(body.Qty) || 0 : -(Number(body.Qty) || 0),
      AvgRate: order.Rate,
      LTP: order.Rate,
      MTOM: 0,
      ExchOrderID: orderId,
    });
  }

  // Update margin
  if (body.BuySell === "S") {
    const qty = Number(body.Qty) || 0;
    const marginHit = qty * (body.Price || spot) * 5;
    state.margin.UsedMargin = roundTo(state.margin.UsedMargin + marginHit, 2);
    state.margin.AvailableMargin = roundTo(
      state.margin.NetMargin - state.margin.UsedMargin,
      2
    );
  }

  return {
    Status: 0,
    Message: "Order placed successfully",
    BrokerOrderID: orderId,
    ExchOrderID: orderId,
    ClientCode: CLIENT_CODE,
  };
}

// ─── Scenario Triggers ──────────────────────

const scenarios = {
  /** Sudden price spike up */
  spikeUp(percent = 1) {
    state.nifty.spike(percent);
    updatePositionLTPs();
    return `Nifty spiked UP ${percent}% → ${state.nifty.price}`;
  },

  /** Sudden price crash */
  spikeDown(percent = 1) {
    state.nifty.spike(-percent);
    updatePositionLTPs();
    return `Nifty spiked DOWN ${percent}% → ${state.nifty.price}`;
  },

  /** Set bullish trend */
  trendBullish() {
    state.nifty.setTrend(1);
    return "Nifty trend set to BULLISH";
  },

  /** Set bearish trend */
  trendBearish() {
    state.nifty.setTrend(-1);
    return "Nifty trend set to BEARISH";
  },

  /** Set range-bound */
  trendNeutral() {
    state.nifty.setTrend(0);
    return "Nifty trend set to NEUTRAL";
  },

  /** Volatility crush */
  volCrush() {
    state.baseIV = 0.08;
    state.vix = 10;
    updatePositionLTPs();
    return `Volatility crushed: IV=${state.baseIV * 100}%, VIX=${state.vix}`;
  },

  /** Volatility expansion */
  volExpand() {
    state.baseIV = 0.25;
    state.vix = 22;
    updatePositionLTPs();
    return `Volatility expanded: IV=${state.baseIV * 100}%, VIX=${state.vix}`;
  },

  /** Reset IV to normal */
  volNormal() {
    state.baseIV = 0.14;
    state.vix = 13.5;
    updatePositionLTPs();
    return `Volatility normal: IV=${state.baseIV * 100}%, VIX=${state.vix}`;
  },

  /** Simulate time decay (reduce DTE effect) */
  fastForward(hours = 6) {
    // We can't actually fast-forward time, but we reduce the base IV effect
    // which mimics theta decay
    state.baseIV = Math.max(0.05, state.baseIV - 0.005 * hours);
    updatePositionLTPs();
    return `Fast-forwarded ${hours}h. IV now ${roundTo(state.baseIV * 100, 1)}%`;
  },

  /** Set exact Nifty price */
  setPrice(price) {
    state.nifty.price = price;
    state.nifty.basePrice = price;
    updatePositionLTPs();
    return `Nifty set to ${price}`;
  },

  /** Set tick rate */
  setTickRate(ms) {
    state.tickRate = ms;
    stopTickLoop();
    startTickLoop();
    return `Tick rate set to ${ms}ms`;
  },

  /** Reset everything */
  reset() {
    state.nifty = new SpotPriceEngine("NIFTY", 22500, 0.0003);
    state.bankNifty = new SpotPriceEngine("BANKNIFTY", 48200, 0.0004);
    state.vix = 13.5;
    state.baseIV = 0.14;
    initDefaultPositions();
    return "Simulator reset to defaults";
  },
};

module.exports = {
  state,
  CLIENT_CODE,
  getExpiryString,
  getDaysToExpiry,
  initDefaultPositions,
  updatePositionLTPs,
  startTickLoop,
  stopTickLoop,
  broadcastWS,
  simulatePlaceOrder,
  scenarios,
};
