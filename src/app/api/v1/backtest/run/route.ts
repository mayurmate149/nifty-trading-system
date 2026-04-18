import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/server/middleware/auth";

/**
 * POST /api/v1/backtest/run
 * Runs a backtest for a given strategy, symbol, and date range.
 */
export async function POST(request: NextRequest) {
  return withAuth(request, async (_req, session) => {
    const body = await request.json();

    // TODO: Phase 7 — Call backtest/runner + metrics
    return NextResponse.json({
      summary: {
        winRate: 0,
        avgReturnPerTrade: 0,
        maxDrawdownPercent: 0,
        totalTrades: 0,
      },
      trades: [],
    });
  });
}
