import { NextRequest } from "next/server";
import { getPositions, getMargin } from "@/server/broker-proxy";
import { withAuth } from "@/server/middleware/auth";

/**
 * GET /api/v1/positions/sse
 * SSE endpoint for streaming live positions and margin updates.
 */
export async function GET(_req: NextRequest) {
  const encoder = new TextEncoder();
  let running = true;

  // Extract session using withAuth
  let session: any = null;
  await withAuth(_req, async (__req, s) => {
    session = s;
    return null as any;
  });
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(":ok\n\n"));
      let lastHash = "";
      while (running) {
        try {
          const positions = await getPositions({
            accessToken: session.accessToken,
            clientCode: session.clientCode,
          });
          const margin = await getMargin({
            accessToken: session.accessToken,
            clientCode: session.clientCode,
          });
          const payload = { positions, margin };
          const hash = JSON.stringify(payload).slice(0, 200);
          if (hash !== lastHash) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            lastHash = hash;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 2000));
      }
    },
    cancel() {
      running = false;
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
