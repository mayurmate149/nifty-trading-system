import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/server/middleware/auth";
import { getPositionsApiPayload } from "@/server/trading/positions-payload";

/**
 * GET /api/v1/positions
 * Returns normalized derivatives positions from 5paisa + margin data.
 * If broker margin API returns 0, computes margin from position data.
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (_req, session) => {
    const body = await getPositionsApiPayload(session);
    return NextResponse.json(body);
  });
}
