import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/server/middleware/auth";
import { placeOrder } from "@/server/broker-proxy";
import {
  insertOpenEntryFromExecuteScan,
  type JournalEntryLegRow,
  type JournalGreeks,
  type JournalMarketContext,
  type JournalStrategyContext,
} from "@/server/journal/trade-journal-store";

const DEFAULT_NIFTY_LOT = 75;

type ExecuteScanLeg = {
  action: "BUY" | "SELL";
  scripCode?: number;
  premium: number;
  strike?: number;
  optionType?: "CE" | "PE";
  greeks?: {
    delta?: number;
    gamma?: number;
    theta?: number;
    vega?: number;
    iv?: number;
  };
  oi?: number;
  changeInOi?: number;
  volume?: number;
};

type ExecuteScanBody = {
  legs?: ExecuteScanLeg[];
  quantity?: number;
  strategy?: JournalStrategyContext | null;
  marketContext?: JournalMarketContext | null;
};

function safeGreeks(g?: ExecuteScanLeg["greeks"]): JournalGreeks | undefined {
  if (!g) return undefined;
  const out: JournalGreeks = {};
  if (typeof g.delta === "number") out.delta = g.delta;
  if (typeof g.gamma === "number") out.gamma = g.gamma;
  if (typeof g.theta === "number") out.theta = g.theta;
  if (typeof g.vega === "number") out.vega = g.vega;
  if (typeof g.iv === "number") out.iv = g.iv;
  return Object.keys(out).length ? out : undefined;
}

/**
 * POST /api/v1/trading/execute-scan
 * Places one lot per leg for the given scan (hedge BUY legs first, then SELL) using limit near LTP.
 * F&O: NSE "N" + "D", non-intraday.
 */
export async function POST(request: NextRequest) {
  return withAuth(request, async (req, session) => {
    try {
      const body = (await req.json()) as ExecuteScanBody;
      const legs = body.legs;
      const quantity =
        typeof body.quantity === "number" && body.quantity > 0
          ? body.quantity
          : DEFAULT_NIFTY_LOT;
      const strategy = body.strategy ?? null;
      const marketContext: JournalMarketContext | null = body.marketContext
        ? { ...body.marketContext, source: body.marketContext.source ?? "scan", asOf: new Date() }
        : null;

      if (!Array.isArray(legs) || legs.length === 0) {
        return NextResponse.json({ error: "legs array required" }, { status: 400 });
      }

      const sorted = [...legs].sort((a, b) => {
        if (a.action === b.action) return 0;
        return a.action === "BUY" ? -1 : 1;
      });

      const creds = { accessToken: session.accessToken, clientCode: session.clientCode };
      const results: Array<{
        scripCode: number;
        ok: boolean;
        orderId?: string;
        error?: string;
        buySell: string;
        price: number;
      }> = [];

      for (const leg of sorted) {
        if (!leg.scripCode || leg.scripCode <= 0) {
          results.push({
            scripCode: 0,
            ok: false,
            error:
              "Missing ScripCode. Refresh options data — broker must return scrip on chain.",
            buySell: leg.action === "BUY" ? "B" : "S",
            price: 0,
          });
          continue;
        }

        const buySell: "B" | "S" = leg.action === "BUY" ? "B" : "S";
        const ltp = Number(leg.premium) || 1;
        const price = parseFloat(
          (buySell === "B" ? ltp + 0.5 : Math.max(ltp - 0.5, 0.05)).toFixed(2),
        );

        try {
          const r = await placeOrder(creds, {
            scripCode: leg.scripCode,
            quantity,
            buySell,
            exchange: "N",
            exchangeType: "D",
            price,
            isIntraday: false,
            atMarket: false,
          });
          results.push({
            scripCode: leg.scripCode,
            ok: true,
            orderId: r?.ExchOrderID != null ? String(r.ExchOrderID) : undefined,
            buySell,
            price,
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          results.push({
            scripCode: leg.scripCode,
            ok: false,
            error: msg,
            buySell,
            price,
          });
        }
      }

      const allOk = results.every((r) => r.ok);

      const journalEntryLegs: JournalEntryLegRow[] = results.map((r, i) => {
        const leg = sorted[i];
        const action: "BUY" | "SELL" =
          leg?.action ?? (r.buySell === "B" ? "BUY" : "SELL");
        const sideSign = action === "BUY" ? -1 : 1; // SELL collects, BUY pays
        const legPremiumRupees = r.ok
          ? Math.round(sideSign * r.price * quantity * 100) / 100
          : 0;
        return {
          scripCode: r.scripCode || leg?.scripCode || 0,
          action,
          quantity,
          limitPrice: r.price,
          premiumLtp: typeof leg?.premium === "number" ? leg.premium : undefined,
          strike: leg?.strike,
          optionType: leg?.optionType,
          greeks: safeGreeks(leg?.greeks),
          oi: typeof leg?.oi === "number" ? leg.oi : undefined,
          changeInOi:
            typeof leg?.changeInOi === "number" ? leg.changeInOi : undefined,
          volume: typeof leg?.volume === "number" ? leg.volume : undefined,
          legPremiumRupees,
          orderId: r.orderId,
          ok: r.ok,
          error: r.error,
        };
      });

      let journalOpenId: string | null = null;
      try {
        const journalSnap = await insertOpenEntryFromExecuteScan({
          clientCode: session.clientCode,
          quantityLot: quantity,
          strategy,
          marketContext,
          entryLegs: journalEntryLegs,
          allEntryOrdersOk: allOk,
        });
        journalOpenId = journalSnap?.id ?? null;
      } catch (err) {
        console.error(
          "[JOURNAL] Open entry persistence failed:",
          err instanceof Error ? err.message : err,
        );
      }

      return NextResponse.json({
        results,
        quantity,
        allOk,
        journalOpenId,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "execute-scan failed";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  });
}
