import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/server/middleware/auth";
import { getPositions } from "@/server/broker-proxy";
import {
  fetchMarketSnapshot,
  fetchOptionsChain,
  fetchLiveSpotData,
} from "@/server/market-data/rest";
import {
  computePortfolioSummary,
  computeGreeksExposure,
  computePayoffDiagram,
  computeIVSkew,
  getPnLHistory,
  startPnLRecorder,
} from "@/server/market-data/analytics";

const USE_SIMULATOR = process.env.USE_SIMULATOR === "true";

/**
 * GET /api/v1/analytics/summary
 * Returns full analytics dashboard data in a single call.
 *
 * Query params:
 *   ?section=all (default) | portfolio | greeks | payoff | pnl | iv
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (_req, session) => {
    const { searchParams } = new URL(request.url);
    const section = searchParams.get("section") ?? "all";

    try {
      // Fetch positions
      const positions = await getPositions({
        accessToken: session.accessToken,
        clientCode: session.clientCode,
      });

      // Fetch market snapshot / spot data
      let snapshot = null;
      if (USE_SIMULATOR) {
        try {
          snapshot = await fetchMarketSnapshot();
          startPnLRecorder();
        } catch {
          // Simulator might not be running
        }
      } else {
        // Live: populate snapshot cache via V1/MarketFeed
        try {
          await fetchLiveSpotData(session.accessToken);
          snapshot = await fetchMarketSnapshot();
        } catch (e: any) {
          console.error("[ANALYTICS] Live spot fetch failed:", e.message);
        }
      }

      const spot = snapshot?.nifty ?? 22500;

      // Fetch options chain for Greeks
      let chain = null;
      try {
        chain = await fetchOptionsChain(session.accessToken, "NIFTY", "", session.clientCode);
      } catch (e: any) {
        console.error("[ANALYTICS] Options chain fetch failed:", e.message);
      }

      const result: Record<string, any> = {};

      // Portfolio summary
      if (section === "all" || section === "portfolio") {
        result.portfolio = computePortfolioSummary(positions, snapshot);
      }

      // Greeks exposure
      if (section === "all" || section === "greeks") {
        result.greeks = computeGreeksExposure(positions, chain?.chain);
      }

      // Payoff diagram
      if (section === "all" || section === "payoff") {
        result.payoff = computePayoffDiagram(positions, spot);
      }

      // P&L history
      if (section === "all" || section === "pnl") {
        result.pnlHistory = getPnLHistory();
      }

      // IV Skew
      if ((section === "all" || section === "iv") && chain?.chain) {
        result.ivSkew = computeIVSkew(chain.chain);
      }

      // Market overview
      if (section === "all") {
        result.market = {
          spot,
          vix: snapshot?.vix ?? 0,
          iv: snapshot?.iv ?? 0,
          daysToExpiry: snapshot?.daysToExpiry ?? 0,
          expiry: snapshot?.expiry ?? "",
          trend: snapshot?.trend ?? "NEUTRAL",
          bankNifty: snapshot?.bankNifty ?? 0,
        };
      }

      return NextResponse.json(result);
    } catch (error: any) {
      console.error("[ANALYTICS] Error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  });
}
