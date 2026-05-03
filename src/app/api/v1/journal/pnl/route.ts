import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/server/middleware/auth";
import {
  summarizePnlByPeriod,
  type PnlPeriod,
} from "@/server/journal/trade-journal-store";
import { isMongoConfigured } from "@/server/db/mongo-client";

function parsePeriod(v: string | null): PnlPeriod {
  if (v === "day" || v === "week" || v === "month" || v === "year") return v;
  return "month";
}

/**
 * GET /api/v1/journal/pnl?period=week|month|year
 * Aggregates CLOSED portfolio exit rows — P&L is broker MTOM (₹ sum) captured at exit trigger.
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (_req, session) => {
    try {
      if (!isMongoConfigured()) {
        return NextResponse.json({
          mongoConfigured: false,
          period: parsePeriod(request.nextUrl.searchParams.get("period")),
          buckets: [],
          message:
            "Set MONGODB_URI and optionally MONGODB_DB_NAME in the environment.",
        });
      }

      const q = request.nextUrl.searchParams.get("period");
      if (q != null && q !== "day" && q !== "week" && q !== "month" && q !== "year") {
        return NextResponse.json(
          { error: "period must be day, week, month, or year" },
          { status: 400 },
        );
      }
      const period = parsePeriod(q);

      const { buckets, overall, mongoConfigured } = await summarizePnlByPeriod(
        session.clientCode,
        period,
      );
      return NextResponse.json({ mongoConfigured, period, buckets, overall });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "journal pnl failed";
      console.error("[JOURNAL] GET /journal/pnl failed:", msg);
      return NextResponse.json(
        { error: msg, message: msg },
        { status: 500 },
      );
    }
  });
}
