import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/server/middleware/auth";
import { fetchOptionsChain, fetchLiveSpotData, fetchMarketSnapshot, fetchOHLC } from "@/server/market-data/rest";
import { classifyTrend } from "@/server/market-data/trend";
import { calculateSupportResistance } from "@/server/market-data/support-resistance";
import { computeIVPercentile } from "@/server/market-data/analytics";
import { generateSuggestions } from "@/server/engine/suggest";
import type { MarketIndicators } from "@/types/market";
import type { SuggestRequest, SuggestResponse } from "@/types/strategy";

const USE_SIMULATOR = process.env.USE_SIMULATOR === "true";

/**
 * POST /api/v1/strategy/suggest
 * Returns ranked trade suggestions for NIFTY based on live market conditions.
 *
 * Body: SuggestRequest { symbol, expiry?, strategies?, riskParams }
 */
export async function POST(request: NextRequest) {
  return withAuth(request, async (_req, session) => {
    try {
      const body: Partial<SuggestRequest> = await request.json();

      const symbol = body.symbol ?? "NIFTY";
      const riskParams = {
        maxCapitalPercent: 5,
        confidenceThreshold: 50,
        lotSize: 75,
        ...body.riskParams,
      };
      const strategies = body.strategies; // undefined = scan all

      // ─── 1. Parallel: Spot + OHLC (independent calls) ─────
      let spot = 0;
      let prevClose = 0;
      let vix = 0;
      let daysToExpiry = 0;
      let expiry = body.expiry ?? "";
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
        expiry = expiry || snapshot.expiry;
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
        expiry = expiry || snapshot.expiry;
        bars = ohlc;
      }

      if (spot === 0) {
        return NextResponse.json({
          suggestions: [],
          scannedAt: new Date().toISOString(),
          marketSnapshot: { spot: 0, vix: 0, trend: "range-bound", pcr: 0, ivPercentile: 0 },
          error: "Could not fetch spot price",
        });
      }

      // Trend + S/R from OHLC bars
      const trendResult = classifyTrend(bars, spot);
      const sr = calculateSupportResistance(bars);
      const ivPercentile = computeIVPercentile(vix);

      const spotChange = Math.round((spot - prevClose) * 100) / 100;
      const spotChangePct =
        prevClose > 0 ? Math.round((spotChange / prevClose) * 10000) / 100 : 0;

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
        pcr: 0, // Enriched from chain below
        ivPercentile,
        daysToExpiry,
        expiry,
      };

      // ─── 2. Fetch Options Chain (pass pre-fetched spot) ────
      const chainResponse = await fetchOptionsChain(
        session.accessToken,
        symbol,
        expiry,
        session.clientCode,
        { nifty: spot, bankNifty: 0, vix },
      );

      // ─── 3. Run Engine ─────────────────────────
      const result: SuggestResponse = generateSuggestions({
        indicators,
        chainResponse,
        request: {
          symbol,
          expiry,
          strategies,
          riskParams,
        },
      });

      return NextResponse.json(result);
    } catch (error: any) {
      console.error("[SUGGEST] Error:", error.message, error.stack);
      return NextResponse.json(
        {
          suggestions: [],
          scannedAt: new Date().toISOString(),
          marketSnapshot: { spot: 0, vix: 0, trend: "range-bound", pcr: 0, ivPercentile: 0 },
          error: error.message,
        },
        { status: 200 }, // Return 200 with empty suggestions so UI doesn't break
      );
    }
  });
}

