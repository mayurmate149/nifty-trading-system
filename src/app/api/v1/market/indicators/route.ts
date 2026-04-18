import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/server/middleware/auth";
import {
  fetchOHLC,
  fetchMarketSnapshot,
  fetchLiveSpotData,
} from "@/server/market-data/rest";
import { classifyTrend } from "@/server/market-data/trend";
import { calculateSupportResistance } from "@/server/market-data/support-resistance";
import { computeIVPercentile } from "@/server/market-data/analytics";
import type { MarketIndicators } from "@/types/market";

const USE_SIMULATOR = process.env.USE_SIMULATOR === "true";

const EMPTY_INDICATORS: MarketIndicators = {
  vix: 0,
  spot: 0,
  spotChange: 0,
  spotChangePct: 0,
  support: [],
  resistance: [],
  pivotPoint: 0,
  trend: "range-bound",
  trendStrength: 0,
  pcr: 0,
  ivPercentile: 0,
  daysToExpiry: 0,
  expiry: "",
};

/**
 * GET /api/v1/market/indicators
 * Returns VIX, spot, S/R, trend label, PCR, IV percentile.
 * Works with both simulator and real 5paisa.
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (_req, session) => {
    try {
      let spot = 0;
      let prevClose = 0;
      let vix = 0;
      let daysToExpiry = 0;
      let expiry = "";

      if (USE_SIMULATOR) {
        const snapshot = await fetchMarketSnapshot();
        spot = snapshot.nifty;
        prevClose = snapshot.niftyPrevClose || spot;
        vix = snapshot.vix;
        daysToExpiry = snapshot.daysToExpiry;
        expiry = snapshot.expiry;
      } else {
        // Fetch live spot + VIX + PClose from 5paisa V1/MarketFeed
        const spotData = await fetchLiveSpotData(session.accessToken);
        spot = spotData.nifty;
        prevClose = spotData.niftyPrevClose || spot;
        vix = spotData.vix;

        // Get from snapshot cache (populated by fetchLiveSpotData)
        const snapshot = await fetchMarketSnapshot();
        daysToExpiry = snapshot.daysToExpiry;
        expiry = snapshot.expiry;
      }

      if (spot === 0) {
        return NextResponse.json(EMPTY_INDICATORS);
      }

      const bars = await fetchOHLC(session.accessToken, "NIFTY", "1d", 30);
      const trendResult = classifyTrend(bars, spot);
      const sr = calculateSupportResistance(bars);
      const ivPercentile = computeIVPercentile(vix);

      // Compute spot change from broker-provided previous close (PClose)
      // Falls back to spot itself if prevClose unavailable (zero change)
      const spotChange = Math.round((spot - prevClose) * 100) / 100;
      const spotChangePct =
        prevClose > 0
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
        pcr: 0, // Enriched from chain when fetched
        ivPercentile,
        daysToExpiry,
        expiry,
      };

      return NextResponse.json(indicators);
    } catch (error: any) {
      console.error("[INDICATORS] Error:", error.message);
      return NextResponse.json(EMPTY_INDICATORS, { status: 200 });
    }
  });
}
