import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/server/middleware/auth";
import { placeOrder } from "@/server/broker-proxy";

const DEFAULT_NIFTY_LOT = 75;

/**
 * POST /api/v1/trading/execute-scan
 * Places one lot per leg for the given scan (hedge BUY legs first, then SELL) using limit near LTP.
 * F&O: NSE "N" + "D", non-intraday.
 */
export async function POST(request: NextRequest) {
  return withAuth(request, async (req, session) => {
    try {
      const body = (await req.json()) as {
        legs?: Array<{
          action: "BUY" | "SELL";
          scripCode?: number;
          premium: number;
        }>;
        quantity?: number;
      };
      const legs = body.legs;
      const quantity = typeof body.quantity === "number" && body.quantity > 0
        ? body.quantity
        : DEFAULT_NIFTY_LOT;

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
            error: "Missing ScripCode. Refresh options data — broker must return scrip on chain.",
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
      return NextResponse.json({ results, quantity, allOk });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "execute-scan failed";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  });
}
