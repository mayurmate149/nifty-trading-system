import type { ObjectId } from "mongodb";
import { getMongoDb, isMongoConfigured } from "@/server/db/mongo-client";

export const TRADE_JOURNAL_COLLECTION = "trade_journal";

export type ExitReasonKind =
  | "STOP_LOSS"
  | "TAKE_PROFIT"
  | "BREAKEVEN"
  | "MANUAL_EXIT_ALL";

// ─── Greeks ──────────────────────────────────

/** Standard option Greeks (per-share, broker-style sign convention). */
export interface JournalGreeks {
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  /** rho is rarely shown; optional. */
  rho?: number;
  iv?: number;
}

/** Market context captured at the moment of an entry/exit event. */
export interface JournalMarketContext {
  spot?: number;
  spotChange?: number;
  spotChangePct?: number;
  vix?: number;
  pcr?: number;
  ivPercentile?: number;
  trend?: string;
  trendStrength?: number;
  daysToExpiry?: number;
  expiry?: string;
  /** Source of the snapshot: client-supplied scan, server-fetched indicators, broker, etc. */
  source?: "scan" | "indicators" | "broker" | "estimate";
  asOf?: Date;
}

// ─── Entry strategy meta ──────────────────────

/** Trade structure metrics from the auto-scanner (per lot). */
export interface JournalStrategyMetrics {
  netCredit?: number;
  maxProfit?: number;
  maxLoss?: number;
  riskReward?: number;
  marginRequired?: number;
  winProbability?: number;
  expectedValue?: number;
  kellyScore?: number;
  thetaDecayPerDay?: number;
  score?: number;
  breakeven?: number[];
  oiWall?: string;
  targetTime?: string;
  warnings?: string[];
}

export interface JournalStrategyContext {
  scanTradeId?: string;
  tradeType?: string;
  direction?: string;
  edge?: string;
  rationale?: string[];
  metrics?: JournalStrategyMetrics;
}

// ─── Entry leg ───────────────────────────────

/** One leg as placed at entry (execute-scan). */
export interface JournalEntryLegRow {
  scripCode: number;
  action: "BUY" | "SELL";
  quantity: number;
  limitPrice: number;
  premiumLtp?: number;
  strike?: number;
  optionType?: "CE" | "PE";
  greeks?: JournalGreeks;
  oi?: number;
  changeInOi?: number;
  volume?: number;
  /** Estimated rupees on this leg = qty * limitPrice (sign by side). */
  legPremiumRupees?: number;
  orderId?: string;
  ok: boolean;
  error?: string;
}

// ─── Exit leg ────────────────────────────────

export interface JournalPositionSnapshot {
  scripCode: number;
  symbol: string;
  strike?: number;
  optionType?: "CE" | "PE";
  quantity: number;
  avgPrice: number;
  ltp: number;
  mtmRupee: number;
  /** Unsigned exposure (avgPrice × |qty|). */
  exposureRupees?: number;
  /** Greeks at exit — per share, scaled later in analytics. */
  greeks?: JournalGreeks;
  /** Greeks scaled by signed quantity (delta), |qty| (others). */
  scaledGreeks?: JournalGreeks;
}

export interface JournalExitOrderRow {
  scripCode: number;
  symbol: string;
  strike?: number;
  optionType?: "CE" | "PE";
  buySell: "B" | "S";
  quantity: number;
  limitPrice: number;
  ltpAtExit?: number;
  orderId?: string;
  ok: boolean;
  error?: string;
  mtmRupeeBeforeExit: number;
}

/** Aggregated leg-side Greeks for the whole portfolio at exit. */
export interface JournalAggregatedGreeks {
  netDelta?: number;
  netGamma?: number;
  netTheta?: number;
  netVega?: number;
}

// ─── Records ─────────────────────────────────

export type TradeJournalRecord =
  | {
      _id?: ObjectId;
      clientCode: string;
      recordType: "OPEN_ENTRY";
      lifecycle: "OPEN" | "SUPERSEDED";
      createdAt: Date;
      openedAt: Date;
      supersededAt?: Date;
      supersedeNote?: string;
      source: "execute-scan";
      quantityLot: number;
      strategy?: JournalStrategyContext | null;
      marketContext?: JournalMarketContext | null;
      entryLegs: JournalEntryLegRow[];
      allEntryOrdersOk: boolean;
      /** Convenience: net premium across legs (positive = credit, negative = debit). */
      netPremiumRupees?: number;
    }
  | {
      _id?: ObjectId;
      clientCode: string;
      recordType: "PORTFOLIO_EXIT";
      lifecycle: "CLOSED";
      createdAt: Date;
      closedAt: Date;
      source: "auto-exit" | "manual-exit-all";
      exitReason: ExitReasonKind;
      portfolioPnlPct: number;
      pnlRupees: number;
      capitalAtSnapshot: number;
      legCount: number;
      legsAtExit: JournalPositionSnapshot[];
      exitOrders: JournalExitOrderRow[];
      exitSuccessCount: number;
      exitFailCount: number;
      marketContext?: JournalMarketContext | null;
      aggregatedGreeks?: JournalAggregatedGreeks | null;
      /** Linkage to most recent OPEN_ENTRY for this client (if any). */
      linkedOpenEntryId?: string | null;
      linkedOpenedAt?: Date | null;
      holdingDurationMs?: number | null;
    };

// ─── Indexes ─────────────────────────────────

let indexesEnsured = false;

export async function ensureTradeJournalIndexes(): Promise<void> {
  if (!isMongoConfigured() || indexesEnsured) return;
  const db = await getMongoDb();
  try {
    const col = db.collection(TRADE_JOURNAL_COLLECTION);
    await col.createIndex({ clientCode: 1, createdAt: -1 });
    await col.createIndex({ clientCode: 1, recordType: 1, createdAt: -1 });
  } catch (e) {
    console.warn(
      "[JOURNAL] createIndex failed (reads/writes may still work; ensure DB user can createIndexes):",
      e instanceof Error ? e.message : e,
    );
  }
  indexesEnsured = true;
}

// ─── Helpers ─────────────────────────────────

function legSideSign(action: "BUY" | "SELL"): 1 | -1 {
  return action === "BUY" ? 1 : -1;
}

function netPremiumFromLegs(legs: JournalEntryLegRow[]): number {
  let net = 0;
  for (const l of legs) {
    if (!l.ok) continue;
    const px = Number(l.limitPrice ?? l.premiumLtp ?? 0);
    const qty = Number(l.quantity ?? 0);
    if (!Number.isFinite(px) || !Number.isFinite(qty)) continue;
    // Selling collects premium (positive); buying pays (negative).
    net += -legSideSign(l.action) * px * qty;
  }
  return Math.round(net * 100) / 100;
}

// ─── Inserts ─────────────────────────────────

export async function insertOpenEntryFromExecuteScan(input: {
  clientCode: string;
  quantityLot: number;
  strategy?: JournalStrategyContext | null;
  marketContext?: JournalMarketContext | null;
  entryLegs: JournalEntryLegRow[];
  allEntryOrdersOk: boolean;
}): Promise<{ id: string } | null> {
  if (!isMongoConfigured()) return null;
  await ensureTradeJournalIndexes();
  const now = new Date();
  const netPremiumRupees = netPremiumFromLegs(input.entryLegs);
  const doc: TradeJournalRecord = {
    clientCode: input.clientCode,
    recordType: "OPEN_ENTRY",
    lifecycle: "OPEN",
    createdAt: now,
    openedAt: now,
    source: "execute-scan",
    quantityLot: input.quantityLot,
    strategy: input.strategy ?? null,
    marketContext: input.marketContext ?? null,
    entryLegs: input.entryLegs,
    allEntryOrdersOk: input.allEntryOrdersOk,
    netPremiumRupees,
  };
  const db = await getMongoDb();
  const r = await db.collection(TRADE_JOURNAL_COLLECTION).insertOne(doc as any);
  return { id: r.insertedId.toString() };
}

export async function insertPortfolioExit(input: {
  clientCode: string;
  source: "auto-exit" | "manual-exit-all";
  exitReason: ExitReasonKind;
  portfolioPnlPct: number;
  pnlRupees: number;
  capitalAtSnapshot: number;
  legsAtExit: JournalPositionSnapshot[];
  exitOrders: JournalExitOrderRow[];
  marketContext?: JournalMarketContext | null;
  aggregatedGreeks?: JournalAggregatedGreeks | null;
}): Promise<{ id: string } | null> {
  if (!isMongoConfigured()) return null;
  await ensureTradeJournalIndexes();
  const now = new Date();
  const exitSuccessCount = input.exitOrders.filter((o) => o.ok).length;
  const exitFailCount = input.exitOrders.filter((o) => !o.ok).length;

  const db = await getMongoDb();

  // Find the most recent open entry to link this exit to (for holding-duration analytics).
  let linkedOpenEntryId: string | null = null;
  let linkedOpenedAt: Date | null = null;
  let holdingDurationMs: number | null = null;
  try {
    const open = await db.collection(TRADE_JOURNAL_COLLECTION).findOne(
      {
        clientCode: input.clientCode,
        recordType: "OPEN_ENTRY",
        lifecycle: "OPEN",
      },
      { sort: { openedAt: -1 } },
    );
    if (open) {
      linkedOpenEntryId = String(open._id);
      const opened = open.openedAt instanceof Date ? open.openedAt : new Date(open.openedAt as any);
      if (!Number.isNaN(opened.getTime())) {
        linkedOpenedAt = opened;
        holdingDurationMs = now.getTime() - opened.getTime();
      }
    }
  } catch (e) {
    console.warn(
      "[JOURNAL] Could not link exit to open entry:",
      e instanceof Error ? e.message : e,
    );
  }

  const doc: TradeJournalRecord = {
    clientCode: input.clientCode,
    recordType: "PORTFOLIO_EXIT",
    lifecycle: "CLOSED",
    createdAt: now,
    closedAt: now,
    source: input.source,
    exitReason: input.exitReason,
    portfolioPnlPct: input.portfolioPnlPct,
    pnlRupees: input.pnlRupees,
    capitalAtSnapshot: input.capitalAtSnapshot,
    legCount: input.legsAtExit.length,
    legsAtExit: input.legsAtExit,
    exitOrders: input.exitOrders,
    exitSuccessCount,
    exitFailCount,
    marketContext: input.marketContext ?? null,
    aggregatedGreeks: input.aggregatedGreeks ?? null,
    linkedOpenEntryId,
    linkedOpenedAt,
    holdingDurationMs,
  };

  const r = await db.collection(TRADE_JOURNAL_COLLECTION).insertOne(doc as any);
  await db.collection(TRADE_JOURNAL_COLLECTION).updateMany(
    {
      clientCode: input.clientCode,
      recordType: "OPEN_ENTRY",
      lifecycle: "OPEN",
    },
    {
      $set: {
        lifecycle: "SUPERSEDED",
        supersededAt: now,
        supersedeNote:
          "Portfolio exit recorded — open row kept for context; P&L reflected on exit record.",
      },
    },
  );
  return { id: r.insertedId.toString() };
}

// ─── Period bucketing ────────────────────────

/** Day key anchored to IST wall clock (UTC+5:30) — e.g. `2026-05-03`. */
export function dayBucketIST(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Human label for a day bucket — short weekday + medium date in IST. */
function dayLabelIST(d: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

/** ISO week key anchored to IST wall clock (UTC+5:30) — e.g. `2026-W05` */
export function weekBucketIST(d: Date): string {
  const IST_MS = 5.5 * 3600 * 1000;
  const x = new Date(d.getTime() + IST_MS);
  const target = new Date(x.valueOf());
  const dayNr = (x.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
  }
  const weekNum = Math.ceil(
    ((firstThursday - target.valueOf()) / 86400000 + 1) / 7,
  );
  const y = target.getUTCFullYear();
  return `${y}-W${String(weekNum).padStart(2, "0")}`;
}

function monthBucketIST(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  });
  return fmt.format(d);
}

function yearBucketIST(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
  }).format(d);
}

export type PnlPeriod = "day" | "week" | "month" | "year";

export interface PnlBucketSummary {
  bucket: string;
  label: string;
  tradeCount: number;
  totalPnlRupees: number;
  avgPnlRupees: number;
  wins: number;
  losses: number;
  winRatePct: number;
  /** Average win ₹ (only winners). */
  avgWin: number;
  /** Average loss ₹ (only losers, expressed as negative). */
  avgLoss: number;
  /** Profit factor = gross profit ÷ |gross loss|; null when no losers. */
  profitFactor: number | null;
  /** Best winner ₹ in the bucket. */
  bestTrade: number;
  /** Worst loser ₹ in the bucket. */
  worstTrade: number;
  /** Statistical expectancy ₹ per trade. */
  expectancy: number;
  /** Average holding minutes across exits in the bucket; null if unknown. */
  avgHoldingMin: number | null;
}

export interface PnlOverallSummary {
  totalPnlRupees: number;
  tradeCount: number;
  wins: number;
  losses: number;
  winRatePct: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number | null;
  bestTrade: number;
  worstTrade: number;
  expectancy: number;
  avgHoldingMin: number | null;
}

function bucketKeyForExit(closedAt: Date, period: PnlPeriod): { key: string; label: string } {
  if (period === "day") {
    const k = dayBucketIST(closedAt);
    return { key: k, label: dayLabelIST(closedAt) };
  }
  if (period === "week") {
    const k = weekBucketIST(closedAt);
    return { key: k, label: `Week ${k}` };
  }
  if (period === "month") {
    const k = monthBucketIST(closedAt);
    return { key: k, label: k };
  }
  const k = yearBucketIST(closedAt);
  return { key: k, label: k };
}

// ─── Reads ───────────────────────────────────

export async function listJournalForClient(
  clientCode: string,
  limit = 100,
): Promise<{ records: TradeJournalRecord[]; mongoConfigured: boolean }> {
  if (!isMongoConfigured()) {
    return { records: [], mongoConfigured: false };
  }
  await ensureTradeJournalIndexes();
  const db = await getMongoDb();
  const rows = await db
    .collection(TRADE_JOURNAL_COLLECTION)
    .find({ clientCode })
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(limit, 1), 500))
    .toArray();
  return {
    records: rows as unknown as TradeJournalRecord[],
    mongoConfigured: true,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function summarizeExits(
  exits: Array<Extract<TradeJournalRecord, { recordType: "PORTFOLIO_EXIT" }>>,
): {
  total: number;
  wins: number;
  losses: number;
  totalPnl: number;
  grossProfit: number;
  grossLoss: number;
  best: number;
  worst: number;
  avgHoldingMin: number | null;
} {
  let wins = 0;
  let losses = 0;
  let totalPnl = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let best = -Infinity;
  let worst = Infinity;
  let holdSum = 0;
  let holdCount = 0;
  for (const e of exits) {
    const pnl = Number(e.pnlRupees ?? 0);
    totalPnl += pnl;
    if (pnl >= 0) {
      wins += 1;
      grossProfit += pnl;
    } else {
      losses += 1;
      grossLoss += pnl;
    }
    if (pnl > best) best = pnl;
    if (pnl < worst) worst = pnl;
    if (typeof e.holdingDurationMs === "number" && e.holdingDurationMs > 0) {
      holdSum += e.holdingDurationMs / 60000;
      holdCount += 1;
    }
  }
  return {
    total: exits.length,
    wins,
    losses,
    totalPnl,
    grossProfit,
    grossLoss,
    best: best === -Infinity ? 0 : best,
    worst: worst === Infinity ? 0 : worst,
    avgHoldingMin: holdCount === 0 ? null : holdSum / holdCount,
  };
}

function bucketSummary(
  s: ReturnType<typeof summarizeExits>,
  meta: { bucket: string; label: string },
): PnlBucketSummary {
  const winRatePct = s.total === 0 ? 0 : (s.wins / s.total) * 100;
  const avgWin = s.wins === 0 ? 0 : s.grossProfit / s.wins;
  const avgLoss = s.losses === 0 ? 0 : s.grossLoss / s.losses;
  const profitFactor =
    s.losses === 0 ? null : Math.abs(s.grossLoss) === 0 ? null : s.grossProfit / Math.abs(s.grossLoss);
  const expectancy = s.total === 0 ? 0 : s.totalPnl / s.total;
  return {
    bucket: meta.bucket,
    label: meta.label,
    tradeCount: s.total,
    totalPnlRupees: round2(s.totalPnl),
    avgPnlRupees: round2(expectancy),
    wins: s.wins,
    losses: s.losses,
    winRatePct: round2(winRatePct),
    avgWin: round2(avgWin),
    avgLoss: round2(avgLoss),
    profitFactor: profitFactor === null ? null : round2(profitFactor),
    bestTrade: round2(s.best),
    worstTrade: round2(s.worst),
    expectancy: round2(expectancy),
    avgHoldingMin: s.avgHoldingMin === null ? null : round2(s.avgHoldingMin),
  };
}

export async function summarizePnlByPeriod(
  clientCode: string,
  period: PnlPeriod,
): Promise<{
  buckets: PnlBucketSummary[];
  overall: PnlOverallSummary;
  mongoConfigured: boolean;
}> {
  const empty: PnlOverallSummary = {
    totalPnlRupees: 0,
    tradeCount: 0,
    wins: 0,
    losses: 0,
    winRatePct: 0,
    avgWin: 0,
    avgLoss: 0,
    profitFactor: null,
    bestTrade: 0,
    worstTrade: 0,
    expectancy: 0,
    avgHoldingMin: null,
  };

  if (!isMongoConfigured()) {
    return { buckets: [], overall: empty, mongoConfigured: false };
  }
  await ensureTradeJournalIndexes();
  const db = await getMongoDb();
  const exits = (await db
    .collection(TRADE_JOURNAL_COLLECTION)
    .find({ clientCode, recordType: "PORTFOLIO_EXIT" })
    .sort({ closedAt: -1 })
    .limit(2000)
    .toArray()) as unknown as Extract<TradeJournalRecord, { recordType: "PORTFOLIO_EXIT" }>[];

  // Group by period bucket
  const groups = new Map<string, { label: string; rows: typeof exits }>();
  for (const e of exits) {
    const { key, label } = bucketKeyForExit(new Date(e.closedAt), period);
    const cur = groups.get(key) ?? { label, rows: [] as typeof exits };
    cur.rows.push(e);
    groups.set(key, cur);
  }

  const buckets: PnlBucketSummary[] = Array.from(groups.entries())
    .sort(([a], [b]) => (a > b ? -1 : a < b ? 1 : 0))
    .map(([key, v]) => bucketSummary(summarizeExits(v.rows), { bucket: key, label: v.label }));

  // Overall = same numbers but across the entire window we returned (last 2000 exits).
  const overallStats = summarizeExits(exits);
  const overall: PnlOverallSummary = {
    totalPnlRupees: round2(overallStats.totalPnl),
    tradeCount: overallStats.total,
    wins: overallStats.wins,
    losses: overallStats.losses,
    winRatePct:
      overallStats.total === 0
        ? 0
        : round2((overallStats.wins / overallStats.total) * 100),
    avgWin: overallStats.wins === 0 ? 0 : round2(overallStats.grossProfit / overallStats.wins),
    avgLoss: overallStats.losses === 0 ? 0 : round2(overallStats.grossLoss / overallStats.losses),
    profitFactor:
      overallStats.losses === 0 || Math.abs(overallStats.grossLoss) === 0
        ? null
        : round2(overallStats.grossProfit / Math.abs(overallStats.grossLoss)),
    bestTrade: round2(overallStats.best),
    worstTrade: round2(overallStats.worst),
    expectancy: overallStats.total === 0 ? 0 : round2(overallStats.totalPnl / overallStats.total),
    avgHoldingMin:
      overallStats.avgHoldingMin === null ? null : round2(overallStats.avgHoldingMin),
  };

  return { buckets, overall, mongoConfigured: true };
}
