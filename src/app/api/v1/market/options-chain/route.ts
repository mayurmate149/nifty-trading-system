import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/server/middleware/auth";
import { fetchOptionsChain } from "@/server/market-data/rest";

/**
 * GET /api/v1/market/options-chain
 * Returns full options chain with Greeks, OI, IV for a symbol + expiry.
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (_req, session) => {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get("symbol") ?? "NIFTY";
    const expiry = searchParams.get("expiry") ?? "";

    try {
      const chain = await fetchOptionsChain(session.accessToken, symbol, expiry, session.clientCode);
      return NextResponse.json(chain);
    } catch (error: any) {
      console.error("[OPTIONS-CHAIN] Error:", error.message);
      return NextResponse.json(
        {
          underlying: symbol,
          expiry,
          spot: 0,
          vix: 0,
          atmStrike: 0,
          pcr: 0,
          totalCallOI: 0,
          totalPutOI: 0,
          maxCallOIStrike: 0,
          maxPutOIStrike: 0,
          chain: [],
          calls: [],
          puts: [],
        },
        { status: 200 }
      );
    }
  });
}
