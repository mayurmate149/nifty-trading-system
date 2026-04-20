import { NextRequest } from "next/server";
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
 * SSE endpoint for live analytics summary
 * GET /api/v1/analytics/summary/sse?section=all
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (_req, session) => {
    const { searchParams } = new URL(request.url);
    const section = searchParams.get("section") ?? "all";
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
    const endpoint = '/api/v1/analytics/summary/sse';
    function logSSE(msg: string) {
      // eslint-disable-next-line no-console
      console.log(`[SSE analytics-summary] ${msg}`);
    }
    const stream = new ReadableStream({
      async start(controller) {
        async function sendAnalytics() {
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
              } catch {}
            } else {
              try {
                await fetchLiveSpotData(session.accessToken);
                snapshot = await fetchMarketSnapshot();
              } catch {}
            }

            const spot = snapshot?.nifty ?? 22500;

            // Fetch options chain for Greeks
            let chain = null;
            try {
              chain = await fetchOptionsChain(session.accessToken, "NIFTY", "", session.clientCode);
            } catch {}

            const result: Record<string, any> = {};

            if (section === "all" || section === "portfolio") {
              result.portfolio = computePortfolioSummary(positions, snapshot);
            }
            if (section === "all" || section === "greeks") {
              result.greeks = computeGreeksExposure(positions, chain?.chain);
            }
            if (section === "all" || section === "payoff") {
              result.payoff = computePayoffDiagram(positions, spot);
            }
            if (section === "all" || section === "pnl") {
              result.pnlHistory = getPnLHistory();
            }
            if ((section === "all" || section === "iv") && chain?.chain) {
              result.ivSkew = computeIVSkew(chain.chain);
            }
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
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(result)}\n\n`));
            metrics.sseMessages[endpoint] = (metrics.sseMessages[endpoint] || 0) + 1;
            metrics.lastSSEMessage[endpoint] = Date.now();
            logSSE('Sent analytics summary update');
          } catch (error) {
            controller.enqueue(encoder.encode(`data: {\"error\":\"Failed\"}\n\n`));
            metrics.sseErrors[endpoint] = (metrics.sseErrors[endpoint] || 0) + 1;
            logSSE('Error sending analytics summary');
          }
        }
        await sendAnalytics();
        interval = setInterval(sendAnalytics, 5000);
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
