import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/server/middleware/auth";
import {
  fetchOHLC,
  fetchMarketSnapshot,
  fetchLiveSpotData,
  fetchOptionsChain,
} from "@/server/market-data/rest";
import { classifyTrend } from "@/server/market-data/trend";
import { calculateSupportResistance } from "@/server/market-data/support-resistance";
import { computeIVPercentile } from "@/server/market-data/analytics";
import { computeTechnicals } from "@/server/market-data/technicals";
import { generateScalpSignal } from "@/server/engine/scalp-ai";
import type { MarketIndicators } from "@/types/market";

const USE_SIMULATOR = process.env.USE_SIMULATOR === "true";

/**
 * GET /api/v1/strategy/scalp-signal
 *
 * AI Scalp Signal — reads all live data, computes technicals,
 * runs the multi-factor scoring model, returns a BUY/SELL/NO_TRADE signal.
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (_req, session) => {
    try {
      // ─── 1. Parallel: Spot + OHLC (independent calls) ──
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
        return NextResponse.json({
          signal: null,
          error: "Spot price unavailable",
        });
      }

      // ─── 2. Technicals from OHLC ───────────
      const technicals = computeTechnicals(bars);

      // ─── 3. Trend + S/R (sync from bars) ───
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

      // ─── 4. Options Chain (pass pre-fetched spot to skip redundant call) ──
      const chainResponse = await fetchOptionsChain(
        session.accessToken,
        "NIFTY",
        expiry,
        session.clientCode,
        { nifty: spot, bankNifty: 0, vix },
      );

      // Enrich PCR from chain
      indicators.pcr = chainResponse.pcr || 0;

      // ─── 5. Run AI Signal Engine ────────────
      const signal = generateScalpSignal({
        technicals,
        indicators,
        chain: chainResponse.chain,
        spot,
        lotSize: 75,
      });

      return NextResponse.json({
        signal,
        technicals: {
          rsi: technicals.rsi,
          ema9: technicals.ema9,
          ema21: technicals.ema21,
          emaCrossover: technicals.emaCrossover,
          vwap: technicals.vwap,
          priceVsVwap: technicals.priceVsVwap,
          atr: technicals.atr,
          superTrend: technicals.superTrend,
          superTrendSignal: technicals.superTrendSignal,
          momentum: technicals.momentum,
        },
        market: {
          spot,
          spotChange,
          spotChangePct,
          vix,
          pcr: indicators.pcr,
          ivPercentile,
          trend: trendResult.trend,
          trendStrength: trendResult.strength,
          support: sr.support,
          resistance: sr.resistance,
          pivotPoint: sr.pivotPoint,
        },
      });
    } catch (error: any) {
      console.error("[SCALP-AI] Error:", error.message, error.stack);
      return NextResponse.json(
        { signal: null, error: error.message },
        { status: 200 },
      );
    }
  });
}
