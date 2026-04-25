import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/server/middleware/auth";
import { fetchOptionsChain } from "@/server/market-data/rest";
import { buildMarketFeedInstrumentsFromChain } from "@/server/trading/option-chain-ws";

/**
 * GET /api/v1/market/option-chain-ws?symbol=NIFTY&expiry=
 * Returns the same options chain as /market/options-chain plus `wsInstruments`
 * for Xstream `MarketFeedV3` subscription (Exch N, ExchType D, ScripCode per leg).
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (_req, session) => {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get("symbol") ?? "NIFTY";
    const expiry = searchParams.get("expiry") ?? "";

    try {
      const chain = await fetchOptionsChain(
        session.accessToken,
        symbol,
        expiry,
        session.clientCode,
      );
      const wsInstruments = buildMarketFeedInstrumentsFromChain(chain);
      return NextResponse.json({ chain, wsInstruments });
    } catch (error: any) {
      console.error("[OPTION-CHAIN-WS] Error:", error.message);
      return NextResponse.json({
        chain: {
          underlying: symbol,
          expiry: expiry || "",
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
        wsInstruments: [],
        error: error.message,
      });
    }
  });
}
