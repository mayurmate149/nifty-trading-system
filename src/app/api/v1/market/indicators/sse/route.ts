import { NextRequest } from "next/server";
import { withAuth } from "@/server/middleware/auth";
import { fetchOHLC, fetchMarketSnapshot, fetchLiveSpotData } from "@/server/market-data/rest";
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
 * SSE endpoint for live market indicators
 * GET /api/v1/market/indicators/sse
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (_req, session) => {
    const encoder = new TextEncoder();
    let interval: NodeJS.Timeout;
    // Metrics singleton
    const metrics = (global as any).__METRICS__ || ((global as any).__METRICS__ = {
      wsTicksDelivered: 0,
      wsReconnects: 0,
      sseMessages: {},
      sseErrors: {},
      lastTickTimestamp: 0,
      lastSSEMessage: {},
    });
    const endpoint = '/api/v1/market/indicators/sse';
    function logSSE(msg: string) {
      // eslint-disable-next-line no-console
      console.log(`[SSE indicators] ${msg}`);
    }
    const stream = new ReadableStream({
      async start(controller) {
        async function sendIndicators() {
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
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(EMPTY_INDICATORS)}\n\n`));
              metrics.sseMessages[endpoint] = (metrics.sseMessages[endpoint] || 0) + 1;
              metrics.lastSSEMessage[endpoint] = Date.now();
              return;
            }

            const bars = await fetchOHLC(session.accessToken, "NIFTY", "1d", 30);
            const trendResult = classifyTrend(bars, spot);
            const sr = calculateSupportResistance(bars);
            const ivPercentile = computeIVPercentile(vix);
            const spotChange = Math.round((spot - prevClose) * 100) / 100;
            const spotChangePct = prevClose > 0 ? Math.round((spotChange / prevClose) * 10000) / 100 : 0;

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
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(indicators)}\n\n`));
            metrics.sseMessages[endpoint] = (metrics.sseMessages[endpoint] || 0) + 1;
            metrics.lastSSEMessage[endpoint] = Date.now();
            logSSE('Sent indicators update');
          } catch (error) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(EMPTY_INDICATORS)}\n\n`));
            metrics.sseErrors[endpoint] = (metrics.sseErrors[endpoint] || 0) + 1;
            logSSE('Error sending indicators');
          }
        }
        // Send immediately, then every 5s
        await sendIndicators();
        interval = setInterval(sendIndicators, 5000);
      },
      cancel() {
        clearInterval(interval);
      },
    });
    return new (require("next/server").NextResponse)(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  });
}
