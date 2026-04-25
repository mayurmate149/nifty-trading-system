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
 * Server-side market indicators (same logic as GET /api/v1/market/indicators).
 */
export async function getMarketIndicatorsForSession(session: {
  accessToken: string;
}): Promise<MarketIndicators> {
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
      const spotData = await fetchLiveSpotData(session.accessToken);
      spot = spotData.nifty;
      prevClose = spotData.niftyPrevClose || spot;
      vix = spotData.vix;
      const snapshot = await fetchMarketSnapshot();
      daysToExpiry = snapshot.daysToExpiry;
      expiry = snapshot.expiry;
    }

    if (spot === 0) {
      return EMPTY_INDICATORS;
    }

    const bars = await fetchOHLC(session.accessToken, "NIFTY", "1d", 30);
    const trendResult = classifyTrend(bars, spot);
    const sr = calculateSupportResistance(bars);
    const ivPercentile = computeIVPercentile(vix);
    const spotChange = Math.round((spot - prevClose) * 100) / 100;
    const spotChangePct =
      prevClose > 0
        ? Math.round((spotChange / prevClose) * 10000) / 100
        : 0;

    return {
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
  } catch (error: any) {
    console.error("[INDICATORS] Error:", error.message);
    return EMPTY_INDICATORS;
  }
}
