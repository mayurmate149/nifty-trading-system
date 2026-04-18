/**
 * Market Data — REST Client
 *
 * Correct 5paisa implementation using only documented APIs:
 *
 *   1. V1/MarketFeed      — Spot LTP for indices (Nifty, BankNifty, VIX)
 *   2. ScripMaster CSV     — Download all contracts, filter by symbol/expiry
 *   3. MarketSnapshot      — Batched LTP for option contracts (max 50/req)
 *   4. GetOptionsForSymbol  — Dedicated option chain API (fallback)
 *
 * ScripMaster columns:
 *   Exch, ExchType, ScripCode, ScripData, Name, Expiry,
 *   ScripType (CE/PE/XX/EQ), StrikeRate, ISIN, LotSize,
 *   FullName, QtyLimit, TickSize, Multiplier, BOCOAllowed,
 *   SymbolRoot, Series
 */

import {
  OHLCBar,
  OptionsChainResponse,
  OptionChainStrike,
  MarketSnapshot,
} from "@/types/market";

// ──────────────────────────────────────────────
//  Config
// ──────────────────────────────────────────────

const USE_SIMULATOR = process.env.USE_SIMULATOR === "true";
const SIMULATOR_URL = process.env.SIMULATOR_URL || "http://localhost:9500";

const BASE =
  "https://Openapi.5paisa.com/VendorsAPI/Service1.svc";
const SIM_BASE = `${SIMULATOR_URL}/VendorsAPI/Service1.svc`;

// ──────────────────────────────────────────────
//  Payload builders
// ──────────────────────────────────────────────

/** V1/MarketFeed and MarketSnapshot use key-only head */
function marketHead() {
  return { key: process.env.FIVEPAISA_APP_KEY || "" };
}

/** Generic head for order/chain APIs */
function genericHead() {
  return {
    appName: process.env.FIVEPAISA_APP_NAME || "",
    appVer: "1.0",
    key: process.env.FIVEPAISA_APP_KEY || "",
    osName: "WEB",
    requestCode: "",
    userId: process.env.FIVEPAISA_USER_ID || "",
    password: process.env.FIVEPAISA_USER_PASSWORD || "",
  };
}

// ──────────────────────────────────────────────
//  HTTP helper
// ──────────────────────────────────────────────

async function apiPost(
  url: string,
  payload: unknown,
  accessToken: string,
): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error(`[REST] HTTP ${res.status}: ${txt.slice(0, 400)}`);
    throw new Error(`5paisa ${res.status}`);
  }
  return res.json();
}

// ──────────────────────────────────────────────
//  Index ScripCodes (Cash segment)
// ──────────────────────────────────────────────

const NIFTY_SCRIP = 999920000;
const BANKNIFTY_SCRIP = 999920005;
const VIX_SCRIP = 999920019;

// ──────────────────────────────────────────────
//  globalThis snapshot cache
// ──────────────────────────────────────────────

const g = globalThis as any;
if (!g.__liveSnapshot) {
  g.__liveSnapshot = {
    nifty: 0,
    niftyPrevClose: 0,
    bankNifty: 0,
    bankNiftyPrevClose: 0,
    vix: 0,
    iv: 0,
    daysToExpiry: 0,
    expiry: "",
    positionsCount: 0,
    totalPnL: 0,
    margin: { AvailableMargin: 0, UsedMargin: 0, NetMargin: 0 },
    tickRate: 0,
    trend: "NEUTRAL",
  } as MarketSnapshot;
}

function snapshotCache(): MarketSnapshot {
  return g.__liveSnapshot;
}
function updateSnapshot(p: Partial<MarketSnapshot>) {
  Object.assign(g.__liveSnapshot, p);
}

// ─── Spot data cache (avoid redundant V1/MarketFeed calls) ──
if (!g.__spotCache) g.__spotCache = { data: null as any, ts: 0 };
const SPOT_CACHE_TTL = 3_000; // 3 seconds

// ─── Options chain response cache (expensive to build) ──
if (!g.__chainCache) g.__chainCache = { key: "", data: null as any, ts: 0 };
const CHAIN_CACHE_TTL = 10_000; // 10 seconds

// ══════════════════════════════════════════════
//  1. fetchMarketSnapshot  (UI → /indicators)
// ══════════════════════════════════════════════

export async function fetchMarketSnapshot(): Promise<MarketSnapshot> {
  if (USE_SIMULATOR) {
    const r = await fetch(`${SIM_BASE}/snapshot`);
    if (!r.ok) throw new Error(`Snapshot ${r.status}`);
    return r.json();
  }
  return snapshotCache();
}

// ══════════════════════════════════════════════
//  2. fetchLiveSpotData  (V1/MarketFeed)
// ══════════════════════════════════════════════

export async function fetchLiveSpotData(
  accessToken: string,
): Promise<{ nifty: number; niftyPrevClose: number; bankNifty: number; bankNiftyPrevClose: number; vix: number }> {
  // ─── Spot cache: return cached if fresh (<3s) ──
  const now = Date.now();
  if (g.__spotCache.data && now - g.__spotCache.ts < SPOT_CACHE_TTL) {
    return g.__spotCache.data;
  }

  if (USE_SIMULATOR) {
    const snap = await fetchMarketSnapshot();
    const result = { nifty: snap.nifty, niftyPrevClose: snap.niftyPrevClose, bankNifty: snap.bankNifty, bankNiftyPrevClose: snap.bankNiftyPrevClose, vix: snap.vix };
    g.__spotCache = { data: result, ts: Date.now() };
    return result;
  }

  const payload = {
    head: marketHead(),
    body: {
      MarketFeedData: [
        { Exch: "N", ExchType: "C", ScripCode: NIFTY_SCRIP.toString() },
        { Exch: "N", ExchType: "C", ScripCode: BANKNIFTY_SCRIP.toString() },
        { Exch: "N", ExchType: "C", ScripCode: VIX_SCRIP.toString() },
      ],
      ClientLoginType: 0,
      LastRequestTime: "/Date(0)/",
      RefreshRate: "H",
    },
  };

  const data = await apiPost(`${BASE}/V1/MarketFeed`, payload, accessToken);

  const items: any[] = data?.body?.Data ?? [];

  let nifty = 0;
  let niftyPrevClose = 0;
  let bankNifty = 0;
  let bankNiftyPrevClose = 0;
  let vix = 0;

  for (const it of items) {
    const token = parseInt(it.Token ?? it.ScripCode ?? "0", 10);
    const ltp = parseFloat(it.LastRate ?? "0");
    const pclose = parseFloat(it.PClose ?? "0");

    if (token === NIFTY_SCRIP) {
      nifty = ltp;
      niftyPrevClose = pclose;
    } else if (token === BANKNIFTY_SCRIP) {
      bankNifty = ltp;
      bankNiftyPrevClose = pclose;
    } else if (token === VIX_SCRIP) {
      // VIX sometimes returns LastRate=0 during market hours; fallback to PClose
      vix = ltp > 1 ? ltp : pclose > 1 ? pclose : 0;
    }
  }

  const dte = getDaysToExpiry();
  updateSnapshot({
    nifty,
    niftyPrevClose,
    bankNifty,
    bankNiftyPrevClose,
    vix,
    iv: vix > 0 ? Math.round(vix * 10) / 10 : 0,
    daysToExpiry: dte,
    expiry: getNextWeeklyExpiry(),
  });

  const result = { nifty, niftyPrevClose, bankNifty, bankNiftyPrevClose, vix };
  g.__spotCache = { data: result, ts: Date.now() };
  return result;
}

// ══════════════════════════════════════════════
//  3. ScripMaster CSV  (cached in globalThis)
// ══════════════════════════════════════════════

interface ScripRow {
  Exch: string;
  ExchType: string;
  ScripCode: string;
  SymbolRoot: string;
  StrikeRate: string;
  ScripType: string; // CE | PE | XX | EQ
  Expiry: string; // "2025-04-17" etc.
  LotSize: string;
  Name: string;
}

if (!g.__scripMaster) g.__scripMaster = null as ScripRow[] | null;
if (!g.__scripMasterTs) g.__scripMasterTs = 0;

const SCRIP_TTL = 6 * 60 * 60 * 1000; // 6 hours

async function getScripMaster(): Promise<ScripRow[]> {
  const now = Date.now();
  if (g.__scripMaster && now - g.__scripMasterTs < SCRIP_TTL) {
    return g.__scripMaster;
  }

  console.log("[REST] Downloading ScripMaster CSV …");
  const url = `${BASE}/ScripMaster/segment/All`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ScripMaster HTTP ${res.status}`);

  const csv = await res.text();
  const lines = csv.split("\n");
  const header = lines[0].split(",").map((h) => h.trim());

  const colIdx: Record<string, number> = {};
  header.forEach((h, i) => {
    colIdx[h] = i;
  });

  console.log(`[REST] ScripMaster columns: ${header.join(", ")}`);

  const rows: ScripRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    if (parts.length < header.length) continue;

    rows.push({
      Exch: parts[colIdx["Exch"]] ?? "",
      ExchType: parts[colIdx["ExchType"]] ?? "",
      ScripCode: parts[colIdx["ScripCode"]] ?? "",
      SymbolRoot: parts[colIdx["SymbolRoot"]] ?? "",
      StrikeRate: parts[colIdx["StrikeRate"]] ?? "",
      ScripType: parts[colIdx["ScripType"]] ?? "",
      Expiry: parts[colIdx["Expiry"]] ?? "",
      LotSize: parts[colIdx["LotSize"]] ?? "",
      Name: parts[colIdx["Name"]] ?? "",
    });
  }

  g.__scripMaster = rows;
  g.__scripMasterTs = now;

  return rows;
}

/**
 * Filter ScripMaster for option contracts of a given symbol with nearest expiry.
 * Returns array of { ScripCode, StrikeRate, ScripType (CE/PE), Expiry }.
 */
function filterOptionContracts(
  allRows: ScripRow[],
  symbol: string,
): {
  contracts: ScripRow[];
  expiry: string;
} {
  // Filter: NSE F&O, CE or PE, matching symbol
  const opts = allRows.filter(
    (r) =>
      r.Exch === "N" &&
      r.ExchType === "D" &&
      (r.ScripType === "CE" || r.ScripType === "PE") &&
      r.SymbolRoot.toUpperCase() === symbol.toUpperCase() &&
      r.Expiry.length > 0,
  );

  if (opts.length === 0) return { contracts: [], expiry: "" };

  // Find all unique expiries and pick the nearest future one
  const today = new Date().toISOString().split("T")[0]; // "YYYY-MM-DD"
  const expiries = Array.from(new Set(opts.map((r) => r.Expiry))).sort();
  const futureExpiries = expiries.filter((e) => e >= today);
  const nearestExpiry = futureExpiries.length > 0 ? futureExpiries[0] : expiries[expiries.length - 1];

  const contracts = opts.filter((r) => r.Expiry === nearestExpiry);

  return { contracts, expiry: nearestExpiry };
}

// ══════════════════════════════════════════════
//  4. MarketSnapshot (batched, max 50/req)
//     Calls BOTH MarketSnapshot (for OI) and V1/MarketFeed (for LTP),
//     then merges results.
// ══════════════════════════════════════════════

async function batchMarketSnapshot(
  scripCodes: string[],
  accessToken: string,
  clientCode: string,
): Promise<Map<string, any>> {
  const result = new Map<string, any>();
  const BATCH = 50;

  for (let i = 0; i < scripCodes.length; i += BATCH) {
    const batch = scripCodes.slice(i, i + BATCH);

    // ── Run MarketSnapshot + V1/MarketFeed in PARALLEL per batch ──
    const snapPromise = apiPost(
      `${BASE}/MarketSnapshot`,
      {
        head: marketHead(),
        body: {
          ClientCode: clientCode,
          Data: batch.map((sc) => ({
            Exchange: "N",
            ExchangeType: "D",
            ScripCode: sc,
            ScripData: "",
          })),
        },
      },
      accessToken,
    ).catch((e: any) => {
      console.error(`[REST] MarketSnapshot batch ${i} failed:`, e.message);
      return null;
    });

    const feedPromise = apiPost(
      `${BASE}/V1/MarketFeed`,
      {
        head: marketHead(),
        body: {
          MarketFeedData: batch.map((sc) => ({
            Exch: "N",
            ExchType: "D",
            ScripCode: sc,
          })),
          ClientLoginType: 0,
          LastRequestTime: "/Date(0)/",
          RefreshRate: "H",
        },
      },
      accessToken,
    ).catch((e: any) => {
      console.error(`[REST] V1/MarketFeed batch ${i} failed:`, e.message);
      return null;
    });

    const [snapData, feedData] = await Promise.all([snapPromise, feedPromise]);

    // Process MarketSnapshot results (OI data)
    const snapItems: any[] = snapData?.body?.Data ?? [];
    for (const it of snapItems) {
      const token = (it.Token ?? "").toString();
      const scrip = (it.ScripCode ?? "").toString();
      if (token) result.set(token, it);
      if (scrip && scrip !== token) result.set(scrip, it);
    }

    // Merge V1/MarketFeed results (fresher LTP/Volume), preserving OI
    const feedItems: any[] = feedData?.body?.Data ?? [];
    for (const feedIt of feedItems) {
      const token = (feedIt.Token ?? "").toString();
      const scrip = (feedIt.ScripCode ?? "").toString();
      const keys = [token, scrip].filter(Boolean);

      for (const key of keys) {
        const existing = result.get(key);
        if (existing) {
          const oi = existing.OpenInterest;
          const prvOI = existing.PrvOI;
          const chgOI = existing.ChangeInOI;
          Object.assign(existing, feedIt);
          if (oi !== undefined) existing.OpenInterest = oi;
          if (prvOI !== undefined) existing.PrvOI = prvOI;
          if (chgOI !== undefined) existing.ChangeInOI = chgOI;
        } else {
          result.set(key, feedIt);
        }
      }
    }
  }

  return result;
}

// ══════════════════════════════════════════════
//  5. fetchOptionsChain  — ScripMaster + MarketSnapshot approach
// ══════════════════════════════════════════════

export async function fetchOptionsChain(
  accessToken: string,
  symbol: string,
  expiry: string,
  clientCode?: string,
  preSpot?: { nifty: number; bankNifty: number; vix: number },
): Promise<OptionsChainResponse> {
  if (USE_SIMULATOR) {
    return fetchSimulatorChain(symbol, expiry);
  }

  // ─── Chain cache: return cached if same symbol+expiry and <10s old ──
  const cacheKey = `${symbol}|${expiry}`;
  const now = Date.now();
  if (
    g.__chainCache.data &&
    g.__chainCache.key === cacheKey &&
    now - g.__chainCache.ts < CHAIN_CACHE_TTL
  ) {
    return g.__chainCache.data;
  }

  // 5a. Get spot price (use pre-fetched if available)
  let spotData = preSpot
    ? { nifty: preSpot.nifty, bankNifty: preSpot.bankNifty, vix: preSpot.vix }
    : {
        nifty: snapshotCache().nifty,
        bankNifty: snapshotCache().bankNifty,
        vix: snapshotCache().vix,
      };
  if (!preSpot) {
    try {
      const live = await fetchLiveSpotData(accessToken);
      spotData = { nifty: live.nifty, bankNifty: live.bankNifty, vix: live.vix };
    } catch (e: any) {
      console.error("[REST] Spot fetch failed:", e.message);
    }
  }

  const spot =
    symbol.toUpperCase() === "BANKNIFTY"
      ? spotData.bankNifty
      : spotData.nifty;
  const vix = spotData.vix;

  if (spot === 0) {
    console.warn("[REST] Spot price is 0 — returning empty chain");
    return emptyChain(symbol, expiry);
  }

  // 5b. Try GetOptionsForSymbol first (dedicated chain API)
  try {
    const chain = await fetchChainViaGetOptions(
      accessToken,
      symbol,
      spot,
      vix,
      clientCode || "",
    );
    if (chain.chain.length > 0) {
      g.__chainCache = { key: cacheKey, data: chain, ts: Date.now() };
      return chain;
    }
  } catch (e: any) {
    console.error("[REST] GetOptionsForSymbol failed:", e.message);
  }

  // 5c. Fallback: ScripMaster + MarketSnapshot
  try {
    const allRows = await getScripMaster();
    const { contracts, expiry: nearestExpiry } = filterOptionContracts(
      allRows,
      symbol,
    );

    if (contracts.length === 0) {
      console.warn("[REST] No option contracts found in ScripMaster");
      return emptyChain(symbol, expiry);
    }

    const scripCodes = contracts.map((c) => c.ScripCode);
    const snapMap = await batchMarketSnapshot(
      scripCodes,
      accessToken,
      clientCode || "",
    );

    const chainResult = buildChainFromScripMaster(
      contracts,
      snapMap,
      symbol,
      nearestExpiry,
      spot,
      vix,
    );
    g.__chainCache = { key: cacheKey, data: chainResult, ts: Date.now() };
    return chainResult;
  } catch (e: any) {
    console.error("[REST] ScripMaster fallback failed:", e.message);
    return emptyChain(symbol, expiry);
  }
}

// ──────────────────────────────────────────────
//  GetOptionsForSymbol approach
// ──────────────────────────────────────────────

async function fetchChainViaGetOptions(
  accessToken: string,
  symbol: string,
  spot: number,
  vix: number,
  clientCode: string,
): Promise<OptionsChainResponse> {
  // Step 1: Get expiry list
  const expiryPayload = {
    head: genericHead(),
    body: { ClientCode: clientCode, Exch: "N", Symbol: symbol },
  };

  let expiryTimestamp: number;
  let expiryStr = "";

  try {
    const exData = await apiPost(
      `${BASE}/V2/GetExpiryForSymbolOptions`,
      expiryPayload,
      accessToken,
    );
    const expiries: any[] = exData?.body?.Data ?? [];

    if (expiries.length > 0) {
      const raw = (
        expiries[0]?.ExpiryDate ??
        expiries[0]?.Expiry ??
        ""
      ).toString();
      const tsMatch = raw.match(/\/Date\((\d+)/);
      if (tsMatch) {
        expiryTimestamp = parseInt(tsMatch[1], 10);
        expiryStr = new Date(expiryTimestamp).toISOString().split("T")[0];
      } else if (!isNaN(Number(raw))) {
        expiryTimestamp = Number(raw);
        expiryStr = new Date(expiryTimestamp).toISOString().split("T")[0];
      } else {
        expiryTimestamp = getNextExpiryTimestamp();
        expiryStr = getNextWeeklyExpiry();
      }
    } else {
      expiryTimestamp = getNextExpiryTimestamp();
      expiryStr = getNextWeeklyExpiry();
    }
  } catch {
    expiryTimestamp = getNextExpiryTimestamp();
    expiryStr = getNextWeeklyExpiry();
  }

  // Step 2: Fetch chain
  const chainPayload = {
    head: genericHead(),
    body: {
      ClientCode: clientCode,
      Exch: "N",
      Symbol: symbol,
      ExpiryDate: `/Date(${expiryTimestamp})/`,
    },
  };

  const data = await apiPost(
    `${BASE}/GetOptionsForSymbol`,
    chainPayload,
    accessToken,
  );

  const rawItems: any[] = data?.body?.Data ?? [];

  if (rawItems.length > 0) {
    // (debug logs removed for performance)
  }

  if (rawItems.length === 0) {
    return emptyChain(symbol, expiryStr);
  }

  // ── Enrich with live LTP from MarketSnapshot ──
  // GetOptionsForSymbol returns OI but often LTP=0.
  // Extract ScripCodes, call MarketSnapshot in batches, merge LTP/Volume back.
  const scripField = pick(Object.keys(rawItems[0] || {}), [
    "ScripCode", "Token", "scripCode",
  ]);
  const scripCodes: string[] = rawItems
    .map((it: any) => (it[scripField] ?? "").toString())
    .filter((sc: string) => sc && sc !== "0");

  if (scripCodes.length > 0) {
    try {
      const snapMap = await batchMarketSnapshot(scripCodes, accessToken, clientCode);
      let enriched = 0;
      for (const it of rawItems) {
        const sc = (it[scripField] ?? "").toString();
        const snap = snapMap.get(sc);
        if (snap) {
          // Merge live data into the chain item (MarketSnapshot fields override zeros)
          const liveLTP = num(snap.LastRate);
          const prevClose = num(snap.PClose);
          const currentLTP = num(it.LastRate ?? it.LastTradedPrice ?? it.LTP);

          if (liveLTP > 0 && currentLTP === 0) {
            it.LastRate = snap.LastRate;
            it.LastTradedPrice = snap.LastRate;
            it.LTP = snap.LastRate;
          } else if (currentLTP === 0 && prevClose > 0) {
            // Market closed — LastRate=0, use PClose as LTP fallback
            it.LastRate = snap.PClose;
            it.LastTradedPrice = snap.PClose;
            it.LTP = snap.PClose;
          }
          if (intVal(snap.TotalQty) > 0 && intVal(it.TotalQtyTraded ?? it.TotalQty ?? it.Volume) === 0) {
            it.TotalQtyTraded = snap.TotalQty;
            it.TotalQty = snap.TotalQty;
            it.Volume = snap.TotalQty;
          }
          if (num(snap.High) > 0 && !it.High) it.High = snap.High;
          if (num(snap.Low) > 0 && !it.Low) it.Low = snap.Low;
          if (num(snap.PClose) > 0 && !it.PClose) it.PClose = snap.PClose;
          if (num(snap.Chg) !== 0 && !it.Chg) it.Chg = snap.Chg;
          if (num(snap.ChgPcnt) !== 0 && !it.ChgPcnt) it.ChgPcnt = snap.ChgPcnt;
          // Merge PrvOI for ΔOI calculation
          if (intVal(snap.PrvOI) > 0 && !it.PrvOI) it.PrvOI = snap.PrvOI;
          if (intVal(snap.OpenInterest) > 0 && intVal(it.OpenInterest ?? it.OI) === 0) {
            it.OpenInterest = snap.OpenInterest;
            it.OI = snap.OpenInterest;
          }
          enriched++;
        }
      }
      if (enriched === 0) {
        console.warn("[REST] Zero items enriched — ScripCode key mismatch between GetOptionsForSymbol and V1/MarketFeed?");
      }
    } catch (e: any) {
      console.error("[REST] MarketSnapshot enrichment failed:", e.message);
    }
  }

  return mapGetOptionsChain(rawItems, symbol, expiryStr, spot, vix);
}

// ──────────────────────────────────────────────
//  Map GetOptionsForSymbol response
// ──────────────────────────────────────────────

function mapGetOptionsChain(
  items: any[],
  symbol: string,
  expiry: string,
  spot: number,
  vix: number,
): OptionsChainResponse {
  const step = symbol.toUpperCase() === "BANKNIFTY" ? 100 : 50;
  const atm = Math.round(spot / step) * step;

  // Auto-detect field names from the first item
  const sample = items[0] || {};
  const keys = Object.keys(sample);
  const f = {
    strike: pick(keys, ["StrikeRate", "StrikePrice", "Strike"]),
    cpType: pick(keys, ["CpType", "OptionType", "ScripType", "CallPut"]),
    ltp: pick(keys, ["LastRate", "LastTradedPrice", "LTP"]),
    oi: pick(keys, ["OpenInterest", "OI"]),
    volume: pick(keys, ["TotalQtyTraded", "TotalQty", "Volume"]),
    chgOi: pick(keys, ["ChangeInOI", "ChangeInOi", "PrvOI"]),
    iv: pick(keys, ["ImpliedVolatility", "IV"]),
    bid: pick(keys, ["BidPrice", "BuyPrice", "BestBuyPrice"]),
    ask: pick(keys, ["AskPrice", "SellPrice", "BestSellPrice"]),
  };

  // Group by strike
  const strikeMap = new Map<number, { ce?: any; pe?: any }>();
  for (const it of items) {
    const strike = num(it[f.strike]);
    const cp = (it[f.cpType] || "").toString().toUpperCase();
    if (strike <= 0 || !cp) continue;
    if (!strikeMap.has(strike)) strikeMap.set(strike, {});
    const pair = strikeMap.get(strike)!;
    if (cp === "CE") pair.ce = it;
    else if (cp === "PE") pair.pe = it;
  }

  return buildChainOutput(strikeMap, symbol, expiry, spot, vix, atm, step, f);
}

// ──────────────────────────────────────────────
//  Build chain from ScripMaster + MarketSnapshot
// ──────────────────────────────────────────────

function buildChainFromScripMaster(
  contracts: ScripRow[],
  snapMap: Map<string, any>,
  symbol: string,
  expiry: string,
  spot: number,
  vix: number,
): OptionsChainResponse {
  const step = symbol.toUpperCase() === "BANKNIFTY" ? 100 : 50;
  const atm = Math.round(spot / step) * step;

  // Build strike map from ScripMaster rows + snapshot data
  const strikeMap = new Map<number, { ce?: any; pe?: any }>();

  for (const c of contracts) {
    const strike = parseFloat(c.StrikeRate) || 0;
    if (strike <= 0) continue;

    const snap = snapMap.get(c.ScripCode) || {};
    const merged = {
      ...snap,
      _StrikeRate: strike,
      _ScripType: c.ScripType,
      _ScripCode: c.ScripCode,
    };

    if (!strikeMap.has(strike)) strikeMap.set(strike, {});
    const pair = strikeMap.get(strike)!;
    if (c.ScripType === "CE") pair.ce = merged;
    else if (c.ScripType === "PE") pair.pe = merged;
  }

  // For this path, use ScripMaster field names
  const f = {
    strike: "_StrikeRate",
    cpType: "_ScripType",
    ltp: "LastRate",
    oi: "OpenInterest",
    volume: "TotalQty",
    chgOi: "ChangeInOI",
    iv: "ImpliedVolatility",
    bid: "BidPrice",
    ask: "AskPrice",
  };

  return buildChainOutput(strikeMap, symbol, expiry, spot, vix, atm, step, f);
}

// ──────────────────────────────────────────────
//  Common chain builder
// ──────────────────────────────────────────────

interface FieldNames {
  strike: string;
  cpType: string;
  ltp: string;
  oi: string;
  volume: string;
  chgOi: string;
  iv: string;
  bid: string;
  ask: string;
}

function buildChainOutput(
  strikeMap: Map<number, { ce?: any; pe?: any }>,
  symbol: string,
  expiry: string,
  spot: number,
  vix: number,
  atm: number,
  step: number,
  f: FieldNames,
): OptionsChainResponse {
  const sorted = Array.from(strikeMap.keys()).sort((a, b) => a - b);
  const range = 15;
  const filtered = sorted.filter(
    (s) => s >= atm - range * step && s <= atm + range * step,
  );

  let totalCallOI = 0;
  let totalPutOI = 0;
  let maxCallOI = 0;
  let maxPutOI = 0;
  let maxCallOIStrike = atm;
  let maxPutOIStrike = atm;

  const r = 0.07; // risk-free rate ~7% (India)
  const T = Math.max(getDaysToExpiry() / 365, 0.001);

  const chain: OptionChainStrike[] = filtered.map((strike) => {
    const pair = strikeMap.get(strike) || {};
    const ce = pair.ce || {};
    const pe = pair.pe || {};

    // LTP: prefer live LastRate, then PClose from API
    const ceLTP = num(ce[f.ltp]) || num(ce.PClose) || num(ce.pClose) || num(ce.Close) || num(ce.close);
    const peLTP = num(pe[f.ltp]) || num(pe.PClose) || num(pe.pClose) || num(pe.Close) || num(pe.close);
    const ceOI = intVal(ce[f.oi]);
    const peOI = intVal(pe[f.oi]);
    const ceVol = intVal(ce[f.volume]) || intVal(ce.TotalQty);
    const peVol = intVal(pe[f.volume]) || intVal(pe.TotalQty);

    // ΔOI: prefer API ChangeInOI, else compute from OI - PrvOI
    let ceChgOI = intVal(ce[f.chgOi]);
    let peChgOI = intVal(pe[f.chgOi]);
    if (ceChgOI === 0 && intVal(ce.PrvOI) > 0) ceChgOI = ceOI - intVal(ce.PrvOI);
    if (peChgOI === 0 && intVal(pe.PrvOI) > 0) peChgOI = peOI - intVal(pe.PrvOI);

    // IV: prefer API IV, else compute from LTP using Newton-Raphson
    let ceIV = num(ce[f.iv]);
    let peIV = num(pe[f.iv]);
    if (ceIV === 0 && ceLTP > 0) ceIV = impliedVol(spot, strike, T, r, ceLTP, true);
    if (peIV === 0 && peLTP > 0) peIV = impliedVol(spot, strike, T, r, peLTP, false);

    totalCallOI += ceOI;
    totalPutOI += peOI;
    if (ceOI > maxCallOI) {
      maxCallOI = ceOI;
      maxCallOIStrike = strike;
    }
    if (peOI > maxPutOI) {
      maxPutOI = peOI;
      maxPutOIStrike = strike;
    }

    // Proper BS Greeks from computed IV
    const ceSigma = ceIV > 0 ? ceIV / 100 : (vix || 15) / 100;
    const peSigma = peIV > 0 ? peIV / 100 : (vix || 15) / 100;
    const ceGreeks = bsGreeks(spot, strike, T, r, ceSigma, true);
    const peGreeks = bsGreeks(spot, strike, T, r, peSigma, false);

    return {
      strike,
      ce: {
        strike,
        ltp: ceLTP,
        iv: ceIV,
        oi: ceOI,
        changeInOi: ceChgOI,
        volume: ceVol,
        bidPrice: num(ce[f.bid]),
        askPrice: num(ce[f.ask]),
        greeks: ceGreeks,
      },
      pe: {
        strike,
        ltp: peLTP,
        iv: peIV,
        oi: peOI,
        changeInOi: peChgOI,
        volume: peVol,
        bidPrice: num(pe[f.bid]),
        askPrice: num(pe[f.ask]),
        greeks: peGreeks,
      },
    };
  });

  const pcr =
    totalCallOI > 0
      ? Math.round((totalPutOI / totalCallOI) * 100) / 100
      : 0;

  // Count how many strikes have non-zero LTP
  return {
    underlying: symbol,
    expiry,
    spot,
    vix,
    atmStrike: atm,
    pcr,
    totalCallOI,
    totalPutOI,
    maxCallOIStrike,
    maxPutOIStrike,
    chain,
    calls: chain.map((c) => c.ce),
    puts: chain.map((c) => c.pe),
  };
}

// ══════════════════════════════════════════════
//  6. fetchOHLC  (cached synthetic until real API available)
// ══════════════════════════════════════════════

// Cache synthetic bars on globalThis so they stay stable across calls.
// Regenerate only when the base spot moves > 1% (i.e. new session / big move).
if (!g.__ohlcCache) {
  g.__ohlcCache = { base: 0, days: 0, bars: [] as OHLCBar[] };
}

export async function fetchOHLC(
  accessToken: string,
  symbol: string,
  interval: string,
  days: number,
): Promise<OHLCBar[]> {
  if (USE_SIMULATOR) {
    const r = await fetch(
      `${SIM_BASE}/ohlc?symbol=${symbol}&interval=${interval}&days=${days}`,
    );
    if (!r.ok) return syntheticOHLC(days);
    const d = await r.json();
    return d?.bars ?? syntheticOHLC(days);
  }

  const base = snapshotCache().nifty || 22500;
  const cache = g.__ohlcCache;
  const pctDrift = cache.base > 0 ? Math.abs(base - cache.base) / cache.base : 1;

  // Reuse cached bars if base hasn't drifted much and days match
  if (cache.bars.length > 0 && cache.days === days && pctDrift < 0.01) {
    // Update the last bar's close to current spot so trend calcs track live price
    const bars = [...cache.bars];
    const last = { ...bars[bars.length - 1], close: base };
    last.high = Math.max(last.high, base);
    last.low = Math.min(last.low, base);
    bars[bars.length - 1] = last;
    return bars;
  }

  // Generate fresh synthetic bars and cache them
  const bars = syntheticOHLC(days, base);
  g.__ohlcCache = { base, days, bars };
  return bars;
}

// ══════════════════════════════════════════════
//  Simulator chain fetch
// ══════════════════════════════════════════════

async function fetchSimulatorChain(
  symbol: string,
  expiry: string,
): Promise<OptionsChainResponse> {
  const url = `${SIM_BASE}/V2/MarketFeed`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ head: {}, body: { Symbol: symbol } }),
  });
  if (!res.ok) throw new Error(`Sim chain ${res.status}`);
  const data = await res.json();
  const rawChain: any[] = data?.body?.Data ?? [];
  const simExpiry = data?.body?.Expiry ?? expiry;
  const simSpot = data?.body?.Spot ?? 0;
  const simVix = data?.body?.VIX ?? 0;

  const atm = Math.round(simSpot / 50) * 50;
  let totalCallOI = 0;
  let totalPutOI = 0;
  let maxCallOI = 0;
  let maxPutOI = 0;
  let maxCallOIStrike = atm;
  let maxPutOIStrike = atm;

  const chain: OptionChainStrike[] = rawChain.map((row: any) => {
    totalCallOI += row.ce?.oi ?? 0;
    totalPutOI += row.pe?.oi ?? 0;
    if ((row.ce?.oi ?? 0) > maxCallOI) {
      maxCallOI = row.ce.oi;
      maxCallOIStrike = row.strike;
    }
    if ((row.pe?.oi ?? 0) > maxPutOI) {
      maxPutOI = row.pe.oi;
      maxPutOIStrike = row.strike;
    }
    return {
      strike: row.strike,
      ce: {
        strike: row.strike,
        ltp: row.ce?.ltp ?? 0,
        iv: row.ce?.iv ?? 0,
        oi: row.ce?.oi ?? 0,
        changeInOi: row.ce?.changeInOi ?? 0,
        volume: row.ce?.volume ?? 0,
        bidPrice: row.ce?.bidPrice ?? 0,
        askPrice: row.ce?.askPrice ?? 0,
        greeks: {
          delta: row.ce?.delta ?? 0,
          gamma: row.ce?.gamma ?? 0,
          theta: row.ce?.theta ?? 0,
          vega: row.ce?.vega ?? 0,
        },
      },
      pe: {
        strike: row.strike,
        ltp: row.pe?.ltp ?? 0,
        iv: row.pe?.iv ?? 0,
        oi: row.pe?.oi ?? 0,
        changeInOi: row.pe?.changeInOi ?? 0,
        volume: row.pe?.volume ?? 0,
        bidPrice: row.pe?.bidPrice ?? 0,
        askPrice: row.pe?.askPrice ?? 0,
        greeks: {
          delta: row.pe?.delta ?? 0,
          gamma: row.pe?.gamma ?? 0,
          theta: row.pe?.theta ?? 0,
          vega: row.pe?.vega ?? 0,
        },
      },
    };
  });

  const pcr =
    totalCallOI > 0
      ? Math.round((totalPutOI / totalCallOI) * 100) / 100
      : 0;
  return {
    underlying: symbol,
    expiry: simExpiry,
    spot: simSpot,
    vix: simVix,
    atmStrike: atm,
    pcr,
    totalCallOI,
    totalPutOI,
    maxCallOIStrike,
    maxPutOIStrike,
    chain,
    calls: chain.map((c) => c.ce),
    puts: chain.map((c) => c.pe),
  };
}

// ──────────────────────────────────────────────
//  Utility functions
// ──────────────────────────────────────────────

function emptyChain(symbol: string, expiry: string): OptionsChainResponse {
  return {
    underlying: symbol,
    expiry,
    spot: 0,
    vix: 0,
    atmStrike: 0,
    pcr: 0,
    totalCallOI: 0,
    totalPutOI: 0,
    maxCallOIStrike: 0,
    maxPutOIStrike: 0,
    chain: [],
    calls: [],
    puts: [],
  };
}

function num(v: any): number {
  if (v == null || v === "") return 0;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

function intVal(v: any): number {
  if (v == null || v === "") return 0;
  const n = parseInt(v, 10);
  return isNaN(n) ? 0 : n;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function rnd(n: number) {
  return Math.round(n * 10000) / 10000;
}

// ──────────────────────────────────────────────
//  Black-Scholes Greeks & Implied Volatility
// ──────────────────────────────────────────────

/** Standard normal CDF (Abramowitz & Stegun approximation) */
function normCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1.0 / (1.0 + p * Math.abs(x));
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
  return 0.5 * (1.0 + sign * y);
}

/** Standard normal PDF */
function normPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** BS d1/d2 */
function bsD1D2(S: number, K: number, T: number, r: number, sigma: number) {
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  return { d1, d2, sqrtT };
}

/** BS option price */
function bsPrice(S: number, K: number, T: number, r: number, sigma: number): { call: number; put: number } {
  if (T <= 0 || sigma <= 0) return { call: Math.max(S - K, 0), put: Math.max(K - S, 0) };
  const { d1, d2 } = bsD1D2(S, K, T, r, sigma);
  const call = S * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2);
  const put = K * Math.exp(-r * T) * normCDF(-d2) - S * normCDF(-d1);
  return { call: Math.max(call, 0), put: Math.max(put, 0) };
}

/** BS Greeks for a single option */
function bsGreeks(S: number, K: number, T: number, r: number, sigma: number, isCall: boolean) {
  if (T <= 0 || sigma <= 0) {
    const itm = isCall ? S > K : K > S;
    return { delta: itm ? (isCall ? 1 : -1) : 0, gamma: 0, theta: 0, vega: 0 };
  }
  const { d1, d2, sqrtT } = bsD1D2(S, K, T, r, sigma);
  const pdf_d1 = normPDF(d1);
  const expRT = Math.exp(-r * T);

  const delta = isCall ? normCDF(d1) : normCDF(d1) - 1;
  const gamma = pdf_d1 / (S * sigma * sqrtT);
  const theta = (-(S * pdf_d1 * sigma) / (2 * sqrtT)
    - (isCall ? 1 : -1) * r * K * expRT * normCDF(isCall ? d2 : -d2)) / 365;
  const vega = S * sqrtT * pdf_d1 / 100; // per 1% IV change

  return { delta: rnd(delta), gamma: rnd(gamma), theta: rnd(theta), vega: rnd(vega) };
}

/** Implied Volatility from market price via Newton-Raphson (max 20 iterations) */
function impliedVol(S: number, K: number, T: number, r: number, marketPrice: number, isCall: boolean): number {
  if (T <= 0 || marketPrice <= 0) return 0;
  const intrinsic = isCall ? Math.max(S - K * Math.exp(-r * T), 0) : Math.max(K * Math.exp(-r * T) - S, 0);
  if (marketPrice < intrinsic * 0.5) return 0; // too far below intrinsic

  let sigma = 0.2; // initial guess 20%
  for (let i = 0; i < 20; i++) {
    const { d1, sqrtT } = bsD1D2(S, K, T, r, sigma);
    const price = isCall ? bsPrice(S, K, T, r, sigma).call : bsPrice(S, K, T, r, sigma).put;
    const vega = S * sqrtT * normPDF(d1); // raw vega (not /100)
    if (vega < 1e-10) break;
    const diff = price - marketPrice;
    sigma -= diff / vega;
    if (sigma <= 0.001) { sigma = 0.001; break; }
    if (sigma > 5) { sigma = 5; break; }
    if (Math.abs(diff) < 0.01) break;
  }
  return Math.round(sigma * 10000) / 100; // return as percentage e.g. 15.25
}

/** Pick the first matching key from candidates that exists in the keys array */
function pick(keys: string[], candidates: string[]): string {
  for (const c of candidates) {
    if (keys.includes(c)) return c;
  }
  // Case-insensitive fallback
  for (const k of keys) {
    for (const c of candidates) {
      if (k.toLowerCase() === c.toLowerCase()) return k;
    }
  }
  return candidates[0]; // default
}

function getNextWeeklyExpiry(): string {
  const d = new Date();
  const day = d.getDay();
  // Nifty weekly expiry is Thursday
  const diff = day <= 4 ? 4 - day : 4 - day + 7;
  d.setDate(d.getDate() + (diff === 0 && d.getHours() >= 16 ? 7 : diff));
  return d.toISOString().split("T")[0];
}

function getNextExpiryTimestamp(): number {
  const d = new Date();
  const day = d.getDay();
  const diff = day <= 4 ? 4 - day : 4 - day + 7;
  d.setDate(d.getDate() + (diff === 0 && d.getHours() >= 16 ? 7 : diff));
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function getDaysToExpiry(): number {
  const d = new Date();
  const day = d.getDay();
  const diff = day <= 4 ? 4 - day : 4 - day + 7;
  const exp = new Date(d);
  exp.setDate(d.getDate() + (diff === 0 && d.getHours() >= 16 ? 7 : diff));
  exp.setHours(15, 30, 0, 0);
  return Math.max(0.1, (exp.getTime() - d.getTime()) / 86_400_000);
}

function syntheticOHLC(days: number, base = 22500): OHLCBar[] {
  const bars: OHLCBar[] = [];
  let close = base - (Math.random() - 0.3) * 200;
  const now = new Date();
  for (let i = days; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    const open = close + (Math.random() - 0.5) * 100;
    const high = Math.max(open, close) + Math.random() * 80;
    const low = Math.min(open, close) - Math.random() * 80;
    close = low + Math.random() * (high - low);
    bars.push({
      timestamp: date.toISOString().split("T")[0],
      open: rnd2(open),
      high: rnd2(high),
      low: rnd2(low),
      close: rnd2(close),
      volume: Math.floor(50000 + Math.random() * 100000),
    });
  }
  if (bars.length > 0) {
    bars[bars.length - 1].close = base;
    bars[bars.length - 1].high = Math.max(
      bars[bars.length - 1].high,
      base,
    );
    bars[bars.length - 1].low = Math.min(
      bars[bars.length - 1].low,
      base,
    );
  }
  return bars;
}

function rnd2(n: number) {
  return Math.round(n * 100) / 100;
}
