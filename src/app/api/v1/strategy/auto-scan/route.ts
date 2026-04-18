import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/server/middleware/auth";
import {
  fetchLiveSpotData,
  fetchMarketSnapshot,
  fetchOHLC,
  fetchOptionsChain,
} from "@/server/market-data/rest";
import { classifyTrend } from "@/server/market-data/trend";
import { calculateSupportResistance } from "@/server/market-data/support-resistance";
import { computeIVPercentile } from "@/server/market-data/analytics";
import { computeTechnicals } from "@/server/market-data/technicals";
import { runAutoScan } from "@/server/engine/auto-scanner";
import type { MarketIndicators } from "@/types/market";

const USE_SIMULATOR = process.env.USE_SIMULATOR === "true";

/**
 * GET /api/v1/strategy/auto-scan
 *
 * Continuously scans the NIFTY 50 options chain and returns the single
 * best intraday trade targeting ~2% daily return, with win probability,
 * expected value, and full trade reasoning.
 *
 * Query params:
 *   capital — user's total capital (default 200000)
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (_req, session) => {
    try {
      const { searchParams } = new URL(request.url);
      const capital = Number(searchParams.get("capital")) || 200_000;

      // ─── 1. Parallel: Spot + OHLC ──────────
      let spot = 0;
      let prevClose = 0;
      let vix = 0;
      let daysToExpiry = 0;
      let expiry = "";
      let bars: any[] = [];

      if (USE_SIMULATOR) {
        const [snapshot, ohlc] = await Promise.all([
          fetchMarketSnapshot(),
          fetchOHLC(session.accessToken, "NIFTY", "1d", 30),
        ]);
        spot = snapshot.nifty;
        prevClose = snapshot.niftyPrevClose || spot;
        vix = snapshot.vix;
        daysToExpiry = snapshot.daysToExpiry;
        expiry = snapshot.expiry;
        bars = ohlc;
      } else {
        const [spotData, ohlc] = await Promise.all([
          fetchLiveSpotData(session.accessToken),
          fetchOHLC(session.accessToken, "NIFTY", "1d", 30),
        ]);
        spot = spotData.nifty;
        prevClose = spotData.niftyPrevClose || spot;
        vix = spotData.vix;
        const snapshot = await fetchMarketSnapshot();
        daysToExpiry = snapshot.daysToExpiry;
        expiry = snapshot.expiry;
        bars = ohlc;
      }

      if (spot === 0) {
        return NextResponse.json({ bestTrade: null, error: "Spot price unavailable" });
      }

      // ─── 2. Technicals + Trend + S/R ───────
      const technicals = computeTechnicals(bars);
      const trendResult = classifyTrend(bars, spot);
      const sr = calculateSupportResistance(bars);
      const ivPercentile = computeIVPercentile(vix);

      const spotChange = Math.round((spot - prevClose) * 100) / 100;
      const spotChangePct = prevClose > 0
        ? Math.round((spotChange / prevClose) * 10000) / 100
        : 0;

      const indicators: MarketIndicators = {
        vix,
        spot,
        spotChange,
        spotChangePct,
        support: sr.support,
        resistance: sr.resistance,
        pivotPoint: sr.pivotPoint,
        trend: trendResult.trend,
        trendStrength: trendResult.strength,
        pcr: 0,
        ivPercentile,
        daysToExpiry,
        expiry,
      };

      // ─── 3. Options Chain (pre-fetched spot) ─
      const chainResponse = await fetchOptionsChain(
        session.accessToken,
        "NIFTY",
        expiry,
        session.clientCode,
        { nifty: spot, bankNifty: 0, vix },
      );

      indicators.pcr = chainResponse.pcr || 0;

      // ─── 4. Run Auto-Scanner ───────────────
      const result = runAutoScan({
        chain: chainResponse,
        indicators,
        technicals,
        spot,
        capital,
        lotSize: 75,
      });

      return NextResponse.json(result);
    } catch (error: any) {
      console.error("[AUTO-SCAN] Error:", error.message, error.stack);
      return NextResponse.json(
        { bestTrade: null, error: error.message },
        { status: 200 },
      );
    }
  });
}
