import { NextRequest } from "next/server";
import { withAuth } from "@/server/middleware/auth";
import { isEngineRunning, getWatchedPositions, computeRiskSummary, getPortfolioState } from "@/server/risk/auto-exit-engine";
import { getPositions, getMargin } from "@/server/broker-proxy";

/**
 * SSE endpoint for live auto-exit engine status
 * GET /api/v1/auto-exit/sse
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (_req, session) => {
    const encoder = new TextEncoder();
    let interval: NodeJS.Timeout;
    const stream = new ReadableStream({
      async start(controller) {
        async function sendStatus() {
          try {
            const running = isEngineRunning();
            const watched = getWatchedPositions();
            let riskSummary = null;
            if (running) {
              try {
                const creds = {
                  accessToken: session.accessToken,
                  clientCode: session.clientCode,
                };
                const positions = await getPositions(creds);
                let usedMargin = 0;
                try {
                  const margin = await getMargin(creds);
                  usedMargin = margin.usedMargin;
                } catch {}
                riskSummary = computeRiskSummary(positions, usedMargin);
              } catch {}
            }
            const payload = {
              engine: running,
              watched: watched.map((w: any) => ({
                positionId: w.positionId,
                active: w.active,
                currentSLPercent: w.currentSLPercent,
                peakProfitPercent: w.peakProfitPercent,
                config: w.config,
              })),
              riskSummary,
              portfolio: getPortfolioState(),
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
          } catch (error) {
            controller.enqueue(encoder.encode(`data: {\"engine\":false}\n\n`));
          }
        }
        await sendStatus();
        interval = setInterval(sendStatus, 3000);
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
