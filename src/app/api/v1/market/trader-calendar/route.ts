import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/server/middleware/auth";
import { getTraderCalendar } from "@/server/market-data/economic-calendar";
import {
  getIstMonthBounds,
  parseIstMonthFromYyyymm,
} from "@/lib/trader-calendar-utils";

/**
 * GET /api/v1/market/trader-calendar
 *
 * Query:
 *   month — YYYY-MM (IST month to load). Default: current month in IST.
 *   from, to — optional ISO dates (YYYY-MM-DD); if both set, overrides `month`.
 *
 * Returns NSE holidays in range + macro events from Finnhub (free API key: FINNHUB_API_KEY).
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (req) => {
    try {
      const { searchParams } = new URL(req.url);
      const fromQ = searchParams.get("from");
      const toQ = searchParams.get("to");
      const monthQ = searchParams.get("month");

      let from: string;
      let to: string;

      if (fromQ && toQ && /^\d{4}-\d{2}-\d{2}$/.test(fromQ) && /^\d{4}-\d{2}-\d{2}$/.test(toQ)) {
        from = fromQ;
        to = toQ;
      } else {
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: "Asia/Kolkata",
          year: "numeric",
          month: "2-digit",
        }).formatToParts(new Date());
        const y = parts.find((p) => p.type === "year")?.value ?? "1970";
        const mo = parts.find((p) => p.type === "month")?.value ?? "01";
        const yyyymm =
          monthQ && parseIstMonthFromYyyymm(monthQ) ? monthQ : `${y}-${mo}`;
        const parsed = parseIstMonthFromYyyymm(yyyymm);
        if (!parsed) {
          return NextResponse.json({ error: "Invalid month" }, { status: 400 });
        }
        const b = getIstMonthBounds(parsed.year, parsed.month);
        from = b.from;
        to = b.to;
      }

      if (from > to) {
        return NextResponse.json({ error: "from must be <= to" }, { status: 400 });
      }

      const payload = await getTraderCalendar(from, to);
      return NextResponse.json(payload);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "trader-calendar failed";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  });
}
