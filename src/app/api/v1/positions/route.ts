import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/server/middleware/auth";
import { getPositions, getMargin, computeMarginFromPositions } from "@/server/broker-proxy";

/**
 * GET /api/v1/positions
 * Returns normalized derivatives positions from 5paisa + margin data.
 * If broker margin API returns 0, computes margin from position data.
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (_req, session) => {
    const creds = {
      accessToken: session.accessToken,
      clientCode: session.clientCode,
    };

    // Fetch positions and margin independently — margin failure shouldn't break positions
    let positions: any[] = [];
    let margin = null;

    try {
      positions = await getPositions(creds);
    } catch (error: any) {
      console.error("[POSITIONS] Error fetching positions:", error.message);
    }

    try {
      margin = await getMargin(creds);
    } catch (error: any) {
      console.error("[POSITIONS] Error fetching margin:", error.message);
    }

    // If broker margin is 0 or unavailable, calculate from positions
    const computed = computeMarginFromPositions(positions);
    const hasBrokerMargin = margin && (margin.usedMargin > 0 || margin.netMargin > 0);

    if (!hasBrokerMargin && computed.marginRequired > 0) {
      margin = {
        availableMargin: 0,
        usedMargin: computed.marginRequired,
        netMargin: computed.marginRequired,
        marginUtilizedPct: 100,
      };
    }

    return NextResponse.json({
      positions,
      margin,
      fundsBreakdown: computed.fundsBreakdown,
    });
  });
}
