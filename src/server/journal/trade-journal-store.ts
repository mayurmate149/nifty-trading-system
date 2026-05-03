import type { ObjectId } from "mongodb";
import { getMongoDb, isMongoConfigured } from "@/server/db/mongo-client";

export const TRADE_JOURNAL_COLLECTION = "trade_journal";

export type ExitReasonKind =
  | "STOP_LOSS"
  | "TAKE_PROFIT"
  | "BREAKEVEN"
  | "MANUAL_EXIT_ALL";

export interface JournalStrategyContext {
  scanTradeId?: string;
  tradeType?: string;
  direction?: string;
  edge?: string;
  rationale?: string[];
}

/** One leg as placed at entry (execute-scan). */
export interface JournalEntryLegRow {
  scripCode: number;
  action: "BUY" | "SELL";
  quantity: number;
  limitPrice: number;
  strike?: number;
  optionType?: "CE" | "PE";
  orderId?: string;
  ok: boolean;
  error?: string;
}

export interface JournalPositionSnapshot {
  scripCode: number;
  symbol: string;
  quantity: number;
  avgPrice: number;
  ltp: number;
  mtmRupee: number;
}

export interface JournalExitOrderRow {
  scripCode: number;
  symbol: string;
  buySell: "B" | "S";
  quantity: number;
  limitPrice: number;
  orderId?: string;
  ok: boolean;
  error?: string;
  mtmRupeeBeforeExit: number;
}

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
      entryLegs: JournalEntryLegRow[];
      allEntryOrdersOk: boolean;
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
    };

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

export async function insertOpenEntryFromExecuteScan(input: {
  clientCode: string;
  quantityLot: number;
  strategy?: JournalStrategyContext | null;
  entryLegs: JournalEntryLegRow[];
  allEntryOrdersOk: boolean;
}): Promise<{ id: string } | null> {
  if (!isMongoConfigured()) return null;
  await ensureTradeJournalIndexes();
  const now = new Date();
  const doc: TradeJournalRecord = {
    clientCode: input.clientCode,
    recordType: "OPEN_ENTRY",
    lifecycle: "OPEN",
    createdAt: now,
    openedAt: now,
    source: "execute-scan",
    quantityLot: input.quantityLot,
    strategy: input.strategy ?? null,
    entryLegs: input.entryLegs,
    allEntryOrdersOk: input.allEntryOrdersOk,
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
}): Promise<{ id: string } | null> {
  if (!isMongoConfigured()) return null;
  await ensureTradeJournalIndexes();
  const now = new Date();
  const exitSuccessCount = input.exitOrders.filter((o) => o.ok).length;
  const exitFailCount = input.exitOrders.filter((o) => !o.ok).length;
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
  };
  const db = await getMongoDb();
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

export type PnlPeriod = "week" | "month" | "year";

export interface PnlBucketSummary {
  bucket: string;
  label: string;
  tradeCount: number;
  totalPnlRupees: number;
  avgPnlRupees: number;
  wins: number;
  losses: number;
}

function bucketKeyForExit(closedAt: Date, period: PnlPeriod): { key: string; label: string } {
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

export async function summarizePnlByPeriod(
  clientCode: string,
  period: PnlPeriod,
): Promise<{ buckets: PnlBucketSummary[]; mongoConfigured: boolean }> {
  if (!isMongoConfigured()) {
    return { buckets: [], mongoConfigured: false };
  }
  await ensureTradeJournalIndexes();
  const db = await getMongoDb();
  const exits = (await db
    .collection(TRADE_JOURNAL_COLLECTION)
    .find({ clientCode, recordType: "PORTFOLIO_EXIT" })
    .sort({ closedAt: -1 })
    .limit(2000)
    .toArray()) as unknown as Extract<TradeJournalRecord, { recordType: "PORTFOLIO_EXIT" }>[];

  const map = new Map<
    string,
    { label: string; total: number; n: number; wins: number; losses: number }
  >();
  for (const e of exits) {
    const { key, label } = bucketKeyForExit(new Date(e.closedAt), period);
    const cur = map.get(key) ?? { label, total: 0, n: 0, wins: 0, losses: 0 };
    cur.total += e.pnlRupees;
    cur.n += 1;
    if (e.pnlRupees >= 0) cur.wins += 1;
    else cur.losses += 1;
    map.set(key, cur);
  }

  const buckets: PnlBucketSummary[] = Array.from(map.entries())
    .sort(([a], [b]) => (a > b ? -1 : a < b ? 1 : 0))
    .map(([key, v]) => ({
      bucket: key,
      label: v.label,
      tradeCount: v.n,
      totalPnlRupees: Math.round(v.total * 100) / 100,
      avgPnlRupees: v.n ? Math.round((v.total / v.n) * 100) / 100 : 0,
      wins: v.wins,
      losses: v.losses,
    }));

  return { buckets, mongoConfigured: true };
}
