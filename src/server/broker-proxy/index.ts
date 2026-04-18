/**
 * Broker Proxy Module
 *
 * Typed wrapper over 5paisa REST APIs.
 * Uses the same BASE_URL and payload format as the official 5paisa JS SDK.
 * All calls require a valid accessToken (JWT) from session.
 */

import { Position } from "@/types/position";

// ─── Simulator vs Real 5paisa Toggle ─────────
const USE_SIMULATOR = process.env.USE_SIMULATOR === "true";
const SIMULATOR_URL = process.env.SIMULATOR_URL || "http://localhost:9500";

const BASE_URL = USE_SIMULATOR
  ? `${SIMULATOR_URL}/VendorsAPI/Service1.svc`
  : "https://Openapi.5paisa.com/VendorsAPI/Service1.svc";

if (USE_SIMULATOR) {
  console.log("[BROKER] 🎮 SIMULATOR MODE — API base:", BASE_URL);
}

interface BrokerCallOptions {
  accessToken: string;
  clientCode: string;
}

/** Build the standard 5paisa generic payload */
function buildGenericPayload(requestCode: string, clientCode: string) {
  return {
    head: {
      appName: process.env.FIVEPAISA_APP_NAME || "",
      appVer: "1.0",
      key: process.env.FIVEPAISA_APP_KEY || "",
      osName: "WEB",
      requestCode,
      userId: process.env.FIVEPAISA_USER_ID || "",
      password: process.env.FIVEPAISA_USER_PASSWORD || "",
    },
    body: {
      ClientCode: clientCode,
    },
  };
}

/** Make an authenticated POST to 5paisa API */
async function brokerPost(
  route: string,
  payload: any,
  accessToken: string
): Promise<any> {
  const response = await fetch(route, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`[BROKER] HTTP ${response.status}:`, text);
    throw new Error(`5paisa API error: ${response.status}`);
  }

  const data = await response.json();
  return data;
}

// ─── Positions ────────────────────────────────

export async function getPositions(opts: BrokerCallOptions): Promise<Position[]> {
  const payload = buildGenericPayload("5PNPNWV1", opts.clientCode);

  const data = await brokerPost(
    `${BASE_URL}/V1/NetPositionNetWise`,
    payload,
    opts.accessToken
  );

  const details = data?.body?.NetPositionDetail;

  if (!details || !Array.isArray(details)) {
    console.log("[BROKER] No positions found. Response:", JSON.stringify(data?.body?.Message || data?.body));
    return [];
  }

  // Log compact summary of ALL positions
  if (details.length > 0) {
    const summary = details.map((p: any) =>
      `${p.ScripName || p.ScripCode} Qty:${p.NetQty} LTP:${p.LTP} PnL:${p.MTOM} Exch:${p.Exch}/${p.ExchType}`
    ).join(" | ");
    console.log(`[BROKER] ${details.length} positions: ${summary}`);
  }

  // Map 5paisa response → our Position type
  return details.map((p: any): Position => {
    const netQty = parseInt(p.NetQty) || 0;
    const absQty = Math.abs(netQty);

    // 5paisa often returns AvgRate=0; fall back to BuyAvgRate/SellAvgRate
    // For net long (qty > 0) → use BuyAvgRate; for net short (qty < 0) → use SellAvgRate
    let avgPrice = parseFloat(p.AvgRate) || 0;
    if (avgPrice === 0) {
      if (netQty > 0) {
        avgPrice = parseFloat(p.BuyAvgRate) || parseFloat(p.BuyRate) || 0;
      } else if (netQty < 0) {
        avgPrice = parseFloat(p.SellAvgRate) || parseFloat(p.SellRate) || 0;
      }
    }

    // Capital deployed = |qty| × avgPrice × multiplier (lot multiplier, usually 1 for net position)
    // If still 0, try to derive from BuyValue/SellValue
    let capital = absQty * avgPrice;
    if (capital === 0) {
      const buyVal = parseFloat(p.BuyValue) || 0;
      const sellVal = parseFloat(p.SellValue) || 0;
      capital = Math.max(buyVal, sellVal);
    }

    // Detect option type: try OptionType field first, then parse from ScripName
    let optionType: "CALL" | "PUT" = "CALL";
    if (p.OptionType === "CE") {
      optionType = "CALL";
    } else if (p.OptionType === "PE") {
      optionType = "PUT";
    } else {
      // Fallback: parse from symbol name (e.g. "NIFTY 21 Apr 2026 PE 23600.00")
      const symStr = (p.ScripName || p.Symbol || "").toUpperCase();
      if (symStr.includes(" PE ") || symStr.endsWith(" PE")) {
        optionType = "PUT";
      } else if (symStr.includes(" CE ") || symStr.endsWith(" CE")) {
        optionType = "CALL";
      }
    }

    return {
      positionId: `${p.ScripCode}`,
      symbol: p.ScripName || p.Symbol || `${p.ScripCode}`,
      strike: parseFloat(p.StrikeRate) || 0,
      optionType,
      status: (netQty !== 0) ? "OPEN" : "CLOSED",
      quantity: netQty,
      avgPrice,
      ltp: parseFloat(p.LTP) || 0,
      pl: parseFloat(p.MTOM) || 0,
      capitalDeployed: capital,
      maxLossPercent: 1.0,
      maxGainPercent: 2.0,
      exchange: p.Exch || "N",
      exchangeType: p.ExchType || "D",
      isIntraday: p.OrderFor === "I" || p.DayFlag === "I" || false,
    };
  });
}

// ─── Order Book ───────────────────────────────

export async function getOrderBook(opts: BrokerCallOptions): Promise<any[]> {
  const payload = buildGenericPayload("5POrdBkV2", opts.clientCode);

  const data = await brokerPost(
    `${BASE_URL}/V2/OrderBook`,
    payload,
    opts.accessToken
  );

  return data?.body?.OrderBookDetail || [];
}

// ─── Margin Calculation from Positions ────────
// When broker margin API returns 0, compute margin from position data.
//
// For NIFTY/BANKNIFTY option selling, SPAN margin per lot is approximately:
//   - NIFTY:     ₹23,000–₹25,000 per lot for spreads, ~₹1,00,000+ naked
//   - BANKNIFTY: ₹25,000–₹30,000 per lot for spreads, ~₹1,20,000+ naked
//
// Simplified formula:
//   Sell leg SPAN base ≈ (NIFTY spot × lot_size × 12%) per lot  [~₹70K naked/lot]
//   Hedge benefit from buy leg ≈ reduces margin by spread_width × qty
//   Net margin ≈ SPAN_base − hedge_benefit + exposure margin (~3%)
//
// For practical use, we use a per-lot margin estimate:
//   Spread: ~₹23,500/lot for NIFTY, ~₹28,000/lot for BANKNIFTY
//   Naked:  ~₹1,10,000/lot for NIFTY, ~₹1,30,000/lot for BANKNIFTY

const LOT_SIZES: Record<string, number> = {
  NIFTY: 25,
  BANKNIFTY: 15,
  FINNIFTY: 25,
  SENSEX: 10,
};

// Approximate SPAN margin per lot (in ₹)
const SPREAD_MARGIN_PER_LOT: Record<string, number> = {
  NIFTY: 23500,
  BANKNIFTY: 28000,
  FINNIFTY: 20000,
  SENSEX: 18000,
};

const NAKED_MARGIN_PER_LOT: Record<string, number> = {
  NIFTY: 110000,
  BANKNIFTY: 130000,
  FINNIFTY: 90000,
  SENSEX: 80000,
};

function detectUnderlying(symbol: string): string {
  const sym = symbol.toUpperCase();
  if (sym.includes("BANKNIFTY")) return "BANKNIFTY";
  if (sym.includes("FINNIFTY")) return "FINNIFTY";
  if (sym.includes("SENSEX")) return "SENSEX";
  if (sym.includes("NIFTY")) return "NIFTY";
  return "NIFTY"; // default
}

export function computeMarginFromPositions(positions: Position[]): {
  marginRequired: number;
  fundsBreakdown: {
    buyPremium: number;
    sellPremium: number;
    spreadMargin: number;
    nakedSellMargin: number;
    netPremium: number;
  };
} {
  const open = positions.filter((p) => p.status === "OPEN" && p.quantity !== 0);
  const buys = open.filter((p) => p.quantity > 0);
  const sells = open.filter((p) => p.quantity < 0);

  let spreadMargin = 0;
  let nakedSellMargin = 0;
  const matchedBuyIds = new Set<string>();
  const matchedSellIds = new Set<string>();

  // Try to match sell legs with buy legs to form spreads
  for (const sell of sells) {
    const matchingBuy = buys.find(
      (b) =>
        b.optionType === sell.optionType &&
        !matchedBuyIds.has(b.positionId) &&
        Math.abs(b.quantity) === Math.abs(sell.quantity)
    );

    if (matchingBuy) {
      // Spread found — calculate margin using per-lot estimate
      const underlying = detectUnderlying(sell.symbol);
      const lotSize = LOT_SIZES[underlying] || 25;
      const lots = Math.abs(sell.quantity) / lotSize;
      const perLotMargin = SPREAD_MARGIN_PER_LOT[underlying] || 23500;
      const margin = Math.round(lots * perLotMargin);

      spreadMargin += margin;
      matchedBuyIds.add(matchingBuy.positionId);
      matchedSellIds.add(sell.positionId);

      console.log(
        `[MARGIN] Spread: SELL ${sell.strike} + BUY ${matchingBuy.strike} (${underlying}) | ` +
        `${lots} lots × ₹${perLotMargin}/lot = ₹${margin.toLocaleString("en-IN")}`
      );
    }
  }

  // Unmatched sells = naked, need full SPAN margin
  for (const sell of sells) {
    if (!matchedSellIds.has(sell.positionId)) {
      const underlying = detectUnderlying(sell.symbol);
      const lotSize = LOT_SIZES[underlying] || 25;
      const lots = Math.abs(sell.quantity) / lotSize;
      const perLotMargin = NAKED_MARGIN_PER_LOT[underlying] || 110000;
      const margin = Math.round(lots * perLotMargin);
      nakedSellMargin += margin;

      console.log(
        `[MARGIN] Naked SELL ${sell.strike} (${underlying}) | ` +
        `${lots} lots × ₹${perLotMargin}/lot = ₹${margin.toLocaleString("en-IN")}`
      );
    }
  }

  // Unmatched buys = just premium paid (no margin needed, but capital used)
  const unmatchedBuyPremium = buys
    .filter((b) => !matchedBuyIds.has(b.positionId))
    .reduce((sum, b) => sum + Math.abs(b.quantity) * b.avgPrice, 0);

  // Premium totals for display
  const sellPremium = sells.reduce((sum, s) => sum + Math.abs(s.quantity) * s.avgPrice, 0);
  const totalBuyPremium = buys.reduce((sum, b) => sum + Math.abs(b.quantity) * b.avgPrice, 0);
  const netPremium = sellPremium - totalBuyPremium;

  const marginRequired = spreadMargin + nakedSellMargin + unmatchedBuyPremium;

  console.log(
    `[MARGIN] Total — Spread margin: ₹${spreadMargin.toLocaleString("en-IN")} | ` +
    `Naked: ₹${nakedSellMargin.toLocaleString("en-IN")} | ` +
    `Unhedged buy: ₹${unmatchedBuyPremium.toLocaleString("en-IN")} | ` +
    `TOTAL: ₹${marginRequired.toLocaleString("en-IN")} | ` +
    `Net premium: ₹${netPremium.toLocaleString("en-IN")}`
  );

  return {
    marginRequired,
    fundsBreakdown: {
      buyPremium: totalBuyPremium,
      sellPremium,
      spreadMargin,
      nakedSellMargin,
      netPremium,
    },
  };
}

// ─── Margin ───────────────────────────────────

export interface MarginData {
  availableMargin: number;
  usedMargin: number;
  netMargin: number;
  marginUtilizedPct: number;
}

export async function getMargin(opts: BrokerCallOptions): Promise<MarginData> {
  // 5paisa has multiple margin endpoints/request codes across API versions.
  // Try the known combinations until one works.
  const attempts = [
    { url: `${BASE_URL}/V4/Margin`, code: "5PMarginV3" },
    { url: `${BASE_URL}/V3/Margin`, code: "5PMarginV4" },
    { url: `${BASE_URL}/V4/Margin`, code: "5PMarginV4" },
    { url: `${BASE_URL}/V3/Margin`, code: "5PMarginV3" },
  ];

  for (const attempt of attempts) {
    try {
      const payload = buildGenericPayload(attempt.code, opts.clientCode);
      const data = await brokerPost(attempt.url, payload, opts.accessToken);

      const eq = data?.body?.EquityMargin;
      const m = Array.isArray(eq) && eq.length > 0 ? eq[0] : null;

      if (m) {
        // 5paisa field mapping (varies across V3/V4 responses):
        //   V4: MarginUtilized (used), NetAvailableMargin (available), Ledgerbalance (net)
        //   V3: Mgn4Position (used, negative), AvailableMargin (available), GrossMargin (net)
        const usedMargin =
          parseFloat(m.MarginUtilized) ||
          Math.abs(parseFloat(m.Mgn4Position) || 0) ||
          parseFloat(m.UsedMargin) ||
          parseFloat(m.MarginUsed) ||
          parseFloat(m.BlockMargin) ||
          0;

        const availableMargin =
          parseFloat(m.NetAvailableMargin) ||
          parseFloat(m.AvailableMargin) ||
          parseFloat(m.ALB) ||
          0;

        const netMargin =
          parseFloat(m.Ledgerbalance) ||
          parseFloat(m.GrossMargin) ||
          parseFloat(m.NetMargin) ||
          parseFloat(m.TotalMargin) ||
          0;

        const margin: MarginData = {
          availableMargin,
          usedMargin,
          netMargin,
          marginUtilizedPct: usedMargin > 0 && netMargin > 0 ? (usedMargin / netMargin) * 100 : 0,
        };

        // If we got meaningful data, return it
        if (margin.netMargin > 0 || margin.usedMargin > 0 || margin.availableMargin > 0) {
          console.log(`[BROKER] Margin ✅ — Used: ₹${margin.usedMargin} | Available: ₹${margin.availableMargin} | Net: ₹${margin.netMargin}`);
          return margin;
        }
      }
    } catch (err: any) {
      console.warn(`[BROKER] Margin attempt failed (${attempt.url}, ${attempt.code}):`, err.message);
    }
  }

  // All attempts failed — return zeros
  console.warn("[BROKER] ⚠️ All margin API attempts returned no data");
  return { availableMargin: 0, usedMargin: 0, netMargin: 0, marginUtilizedPct: 0 };
}

// ─── Place Order ──────────────────────────────

export async function placeOrder(
  opts: BrokerCallOptions,
  order: {
    scripCode: number;
    quantity: number;
    buySell: "B" | "S";
    exchange: string;
    exchangeType: string;
    price: number;
    isIntraday: boolean;
    atMarket: boolean;
  }
): Promise<any> {
  const payload = {
    head: {
      appName: process.env.FIVEPAISA_APP_NAME || "",
      appVer: "1.0",
      key: process.env.FIVEPAISA_APP_KEY || "",
      osName: "WEB",
      requestCode: "5PPlaceOrdReq",
      userId: process.env.FIVEPAISA_USER_ID || "",
      password: process.env.FIVEPAISA_USER_PASSWORD || "",
    },
    body: {
      ClientCode: opts.clientCode,
      OrderFor: "P",
      Exchange: order.exchange,
      ExchangeType: order.exchangeType,
      ScripCode: order.scripCode,
      Qty: order.quantity,
      Price: order.price,
      BuySell: order.buySell,
      DisQty: order.quantity,
      IsStopLossOrder: false,
      StopLossPrice: 0,
      IsIOCOrder: false,
      IsIntraday: order.isIntraday,
      IsAHOrder: "N",
      AtMarket: order.atMarket,
      TradedQty: 0,
      LegType: 0,
      TMOPartnerOrderID: 0,
      AppSource: parseInt(process.env.FIVEPAISA_APP_SOURCE || "0"),
      OrderRequesterCode: opts.clientCode,
      ValidTillDate: `/Date(${new Date().getTime()})/`,
    },
  };

  const data = await brokerPost(
    `${BASE_URL}/V1/PlaceOrderRequest`,
    payload,
    opts.accessToken
  );

  console.log("[BROKER] PlaceOrder response:", JSON.stringify(data?.body));

  const body = data?.body;
  // 5paisa returns Status=0 for success, non-zero for failure
  if (body && body.Status !== 0 && body.Status !== undefined) {
    const errMsg = body.Message || body.StatusMessage || `Order rejected (Status: ${body.Status})`;
    console.error(`[BROKER] ❌ Order REJECTED: ${errMsg}`);
    throw new Error(errMsg);
  }

  return body;
}

// ─── Modify Order ─────────────────────────────

export async function modifyOrder(
  opts: BrokerCallOptions,
  params: {
    exchangeOrderID: string;
    scripCode: number;
    quantity: number;
    price: number;
    buySell: "B" | "S";
    exchange: string;
    exchangeType: string;
    isIntraday: boolean;
  }
): Promise<any> {
  const payload = {
    head: {
      appName: process.env.FIVEPAISA_APP_NAME || "",
      appVer: "1.0",
      key: process.env.FIVEPAISA_APP_KEY || "",
      osName: "WEB",
      requestCode: "5PModifyOrdReq",
      userId: process.env.FIVEPAISA_USER_ID || "",
      password: process.env.FIVEPAISA_USER_PASSWORD || "",
    },
    body: {
      ClientCode: opts.clientCode,
      ExchOrderID: params.exchangeOrderID,
      ScripCode: params.scripCode,
      Qty: params.quantity,
      Price: params.price,
      BuySell: params.buySell,
      Exchange: params.exchange,
      ExchangeType: params.exchangeType,
      IsIntraday: params.isIntraday,
      AtMarket: false,
      TradedQty: 0,
      AppSource: parseInt(process.env.FIVEPAISA_APP_SOURCE || "0"),
      OrderRequesterCode: opts.clientCode,
    },
  };

  const data = await brokerPost(
    `${BASE_URL}/V1/ModifyOrderRequest`,
    payload,
    opts.accessToken
  );

  return data?.body;
}

// ─── Cancel Order ─────────────────────────────

export async function cancelOrder(
  opts: BrokerCallOptions,
  exchangeOrderID: string
): Promise<any> {
  const payload = buildGenericPayload("5PCancelOrdReq", opts.clientCode);
  (payload.body as any).ExchOrderID = exchangeOrderID;

  const data = await brokerPost(
    `${BASE_URL}/V1/CancelOrderRequest`,
    payload,
    opts.accessToken
  );

  return data?.body;
}
