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
import { buildProfessionalBundle } from "@/server/market-data/professional-indicators";
import { buildStrategyMonitor } from "@/server/engine/strategy-monitor";
import type { MarketIndicators } from "@/types/market";

const USE_SIMULATOR = process.env.USE_SIMULATOR === "true";
const NIFTY_LOT = 75;

/**
 * GET /api/v1/strategy/monitor
 *
 * Pro Trader multi-strategy snapshot. Fetches the same data the auto-scanner
 * does (spot, OHLC, chain) + derives technicals and professional indicators
 * and evaluates each strategy's rule set against the combined context.
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (_req, session) => {
    try {
      let spot = 0;
      let prevClose = 0;
      let vix = 0;
      let daysToExpiry = 0;
      let expiry = "";
      let bars: any[] = [];

      if (USE_SIMULATOR) {
        const [snapshot, ohlc] = await Promise.all([
          fetchMarketSnapshot(),
          fetchOHLC(session.accessToken, "NIFTY", "1d", 60),
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
          fetchOHLC(session.accessToken, "NIFTY", "1d", 60),
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
        return NextResponse.json(
          { error: "Spot price unavailable" },
          { status: 200 },
        );
      }

      const technicals = computeTechnicals(bars);
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
        pcr: 0,
        ivPercentile,
        daysToExpiry,
        expiry,
      };

      const chain = await fetchOptionsChain(
        session.accessToken,
        "NIFTY",
        expiry,
        session.clientCode,
        { nifty: spot, bankNifty: 0, vix },
      );
      indicators.pcr = chain.pcr || 0;

      const professional = buildProfessionalBundle(bars, chain.chain, chain.atmStrike);

      const snapshot = buildStrategyMonitor({
        chain,
        indicators,
        technicals,
        professional,
        spot,
        lotSize: NIFTY_LOT,
      });

      return NextResponse.json(snapshot);
    } catch (error: any) {
      console.error("[STRATEGY_MONITOR] Error:", error?.message, error?.stack);
      return NextResponse.json(
        { error: error?.message || "Strategy monitor failed" },
        { status: 200 },
      );
    }
  });
}
