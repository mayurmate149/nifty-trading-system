import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/server/middleware/auth";
import { buildTradingPageSnapshot } from "@/server/trading/snapshot";

/**
 * GET /api/v1/trading/snapshot
 * Bundles positions, auto-exit, and market indicators in one request for fewer round-trips.
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (_req, session) => {
    const data = await buildTradingPageSnapshot(session);
    return NextResponse.json(data);
  });
}
