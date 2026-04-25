import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/server/middleware/auth";
import { getMarketIndicatorsForSession } from "@/server/trading/market-indicators";

/**
 * GET /api/v1/market/indicators
 * Returns VIX, spot, S/R, trend label, PCR, IV percentile.
 * Works with both simulator and real 5paisa.
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (_req, session) => {
    const indicators = await getMarketIndicatorsForSession(session);
    return NextResponse.json(indicators);
  });
}
