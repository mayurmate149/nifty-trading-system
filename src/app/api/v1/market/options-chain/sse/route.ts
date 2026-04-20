import { NextRequest } from "next/server";
import { withAuth } from "@/server/middleware/auth";
import { fetchOptionsChain } from "@/server/market-data/rest";

/**
 * SSE endpoint for live options chain
 * GET /api/v1/market/options-chain/sse?symbol=NIFTY
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (_req, session) => {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get("symbol") ?? "NIFTY";
    const expiry = searchParams.get("expiry") ?? "";
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
    const endpoint = '/api/v1/market/options-chain/sse';
    function logSSE(msg: string) {
      // eslint-disable-next-line no-console
      console.log(`[SSE options-chain] ${msg}`);
    }
    const stream = new ReadableStream({
      async start(controller) {
        async function sendChain() {
          try {
            const chain = await fetchOptionsChain(session.accessToken, symbol, expiry, session.clientCode);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chain)}\n\n`));
            metrics.sseMessages[endpoint] = (metrics.sseMessages[endpoint] || 0) + 1;
            metrics.lastSSEMessage[endpoint] = Date.now();
            logSSE('Sent options chain update');
          } catch (error) {
            controller.enqueue(encoder.encode(`data: {\"chain\":[]}\n\n`));
            metrics.sseErrors[endpoint] = (metrics.sseErrors[endpoint] || 0) + 1;
            logSSE('Error sending options chain');
          }
        }
        await sendChain();
        interval = setInterval(sendChain, 3000);
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
