/**
 * ═══════════════════════════════════════════════════════════════════
 * NIFTY TRADING SIMULATOR — 5paisa REST API Mock Routes
 * ═══════════════════════════════════════════════════════════════════
 *
 * Exact same URL paths & response shapes as real 5paisa VendorsAPI.
 * Your app's broker-proxy hits these endpoints unchanged.
 */

const { Router } = require("express");
const {
  state,
  CLIENT_CODE,
  getExpiryString,
  getDaysToExpiry,
  simulatePlaceOrder,
} = require("./market-state");
const {
  generateStrikes,
  generateOptionsChain,
  roundTo,
  randInt,
} = require("./data-generators");

const router = Router();

// ─── Middleware: Log every request ───────────

router.use((req, res, next) => {
  console.log(
    `[SIM API] ${req.method} ${req.path}`,
    req.body?.head?.requestCode || ""
  );
  next();
});

// ─── Auth: GetAccessToken ────────────────────
// POST /VendorsAPI/Service1.svc/GetAccessToken
router.post("/GetAccessToken", (req, res) => {
  const { head, body } = req.body || {};

  if (!body?.RequestToken) {
    return res.json({
      body: {
        ClientCode: "",
        AccessToken: "",
        Message: "Invalid RequestToken",
        Status: -1,
      },
    });
  }

  // Always succeed in simulator
  const fakeToken = `SIM_TOKEN_${Date.now()}_${CLIENT_CODE}`;
  console.log(`[SIM AUTH] Token issued for client ${CLIENT_CODE}`);

  res.json({
    body: {
      ClientCode: CLIENT_CODE,
      AccessToken: fakeToken,
      TokenIssuedAt: new Date().toISOString(),
      TokenExpiry: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
      Message: "Success",
      Status: 0,
    },
  });
});

// ─── Net Position (Net-wise) ─────────────────
// POST /V1/NetPositionNetWise
router.post("/V1/NetPositionNetWise", (req, res) => {
  res.json({
    body: {
      NetPositionDetail: state.positions.map((p) => ({
        ScripCode: p.ScripCode,
        ScripName: p.ScripName,
        Symbol: p.Symbol,
        OptionType: p.OptionType,
        StrikeRate: String(p.StrikeRate),
        BuySell: p.BuySell,
        NetQty: String(p.NetQty),
        AvgRate: String(roundTo(p.AvgRate)),
        LTP: String(roundTo(p.LTP)),
        MTOM: String(roundTo(p.MTOM)),
        Exchange: "N",
        ExchangeType: "D",
        Expiry: `/Date(${getNextThursdayMs()})/`,
      })),
      Message: "",
      Status: 0,
    },
  });
});

function getNextThursdayMs() {
  const d = new Date();
  const day = d.getDay();
  const diff = (4 - day + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  d.setHours(15, 30, 0, 0);
  return d.getTime();
}

// ─── Order Book ──────────────────────────────
// POST /V2/OrderBook
router.post("/V2/OrderBook", (req, res) => {
  res.json({
    body: {
      OrderBookDetail: state.orders.map((o) => ({
        ExchOrderID: o.ExchOrderID,
        ScripCode: o.ScripCode,
        ScripName: o.ScripName,
        BuySell: o.BuySell,
        Qty: o.Qty,
        Rate: String(o.Rate),
        Status: o.Status,
        OrderDateTime: o.OrderDateTime,
        AtMarket: o.AtMarket,
        Exchange: o.Exchange,
        ExchangeType: o.ExchangeType,
      })),
      Message: "",
      Status: 0,
    },
  });
});

// ─── Margin ──────────────────────────────────
// POST /V4/Margin
router.post("/V4/Margin", (req, res) => {
  res.json({
    body: {
      EquityMargin: [
        {
          ALB: String(state.margin.AvailableMargin),
          AvailableMargin: String(state.margin.AvailableMargin),
          UsedMargin: String(state.margin.UsedMargin),
          NetMargin: String(state.margin.NetMargin),
          MarginUtilized: String(
            roundTo((state.margin.UsedMargin / state.margin.NetMargin) * 100)
          ),
        },
      ],
      Message: "",
      Status: 0,
    },
  });
});

// ─── Place Order ─────────────────────────────
// POST /V1/PlaceOrderRequest
router.post("/V1/PlaceOrderRequest", (req, res) => {
  const result = simulatePlaceOrder(req.body?.body || {});
  res.json({ body: result });
});

// ─── Modify Order ────────────────────────────
// POST /V1/ModifyOrderRequest
router.post("/V1/ModifyOrderRequest", (req, res) => {
  const body = req.body?.body || {};
  const order = state.orders.find(
    (o) => o.ExchOrderID === body.ExchOrderID
  );

  if (order) {
    order.Rate = body.Price || order.Rate;
    order.Qty = body.Qty || order.Qty;
    order.Status = "Modified";
    console.log(`[SIM] Order ${order.ExchOrderID} modified`);
  }

  res.json({
    body: {
      Status: 0,
      Message: order ? "Order modified successfully" : "Order not found",
      ExchOrderID: body.ExchOrderID,
    },
  });
});

// ─── Cancel Order ────────────────────────────
// POST /V1/CancelOrderRequest
router.post("/V1/CancelOrderRequest", (req, res) => {
  const body = req.body?.body || {};
  const orderIdx = state.orders.findIndex(
    (o) => o.ExchOrderID === body.ExchOrderID
  );

  if (orderIdx >= 0) {
    state.orders[orderIdx].Status = "Cancelled";
    // Remove from positions
    const posIdx = state.positions.findIndex(
      (p) => p.ExchOrderID === body.ExchOrderID
    );
    if (posIdx >= 0) state.positions.splice(posIdx, 1);
    console.log(`[SIM] Order ${body.ExchOrderID} cancelled`);
  }

  res.json({
    body: {
      Status: 0,
      Message:
        orderIdx >= 0 ? "Order cancelled successfully" : "Order not found",
      ExchOrderID: body.ExchOrderID,
    },
  });
});

// ─── Options Chain (extra — for analytics page) ──

router.post("/V2/MarketFeed", (req, res) => {
  const spot = state.nifty.price;
  const strikes = generateStrikes(spot, 50, 15);
  const chain = generateOptionsChain(
    spot,
    strikes,
    state.baseIV,
    getDaysToExpiry()
  );

  res.json({
    body: {
      Data: chain,
      Spot: spot,
      VIX: state.vix,
      Expiry: getExpiryString(),
      Message: "",
      Status: 0,
    },
  });
});

// ─── Market Snapshot (extra — for dashboard) ──

router.get("/snapshot", (req, res) => {
  const totalPnL = state.positions.reduce((sum, p) => sum + p.MTOM, 0);

  res.json({
    nifty: state.nifty.price,
    bankNifty: state.bankNifty.price,
    vix: state.vix,
    iv: roundTo(state.baseIV * 100, 1),
    daysToExpiry: roundTo(getDaysToExpiry(), 2),
    expiry: getExpiryString(),
    positionsCount: state.positions.length,
    totalPnL: roundTo(totalPnL),
    margin: state.margin,
    tickRate: state.tickRate,
    trend: state.nifty.trend === 1 ? "BULLISH" : state.nifty.trend === -1 ? "BEARISH" : "NEUTRAL",
  });
});

// ─── OHLC History (synthetic) ────────────────

router.get("/ohlc", (req, res) => {
  const symbol = req.query.symbol || "NIFTY";
  const days = parseInt(req.query.days) || 30;
  const basePrice = symbol === "BANKNIFTY" ? state.bankNifty.price : state.nifty.price;

  const bars = [];
  let close = basePrice - (Math.random() - 0.3) * 200; // start slightly different
  const now = new Date();

  for (let i = days; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    if (date.getDay() === 0 || date.getDay() === 6) continue;

    const open = close + (Math.random() - 0.5) * 80;
    const high = Math.max(open, close) + Math.random() * 60;
    const low = Math.min(open, close) - Math.random() * 60;
    close = low + Math.random() * (high - low);

    bars.push({
      timestamp: date.toISOString().split("T")[0],
      open: roundTo(open),
      high: roundTo(high),
      low: roundTo(low),
      close: roundTo(close),
      volume: randInt(50000, 200000),
    });
  }

  // Make the last bar's close match the current price
  if (bars.length > 0) {
    bars[bars.length - 1].close = roundTo(basePrice);
    bars[bars.length - 1].high = roundTo(Math.max(bars[bars.length - 1].high, basePrice));
    bars[bars.length - 1].low = roundTo(Math.min(bars[bars.length - 1].low, basePrice));
  }

  res.json({ bars });
});

// ─── Price History (sparkline data) ──────────

router.get("/price-history", (req, res) => {
  const symbol = req.query.symbol || "NIFTY";
  const engine = symbol === "BANKNIFTY" ? state.bankNifty : state.nifty;

  // Return the last N price points from the engine's history
  const history = engine.history || [];
  const points = history.slice(-200).map((h) => ({
    time: h.time,
    price: h.price,
  }));

  res.json({ symbol, points });
});

module.exports = router;
