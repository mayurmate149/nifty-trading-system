// Prevent static generation for this API route
export const dynamic = "force-dynamic";
import { NextRequest } from "next/server";
import { getEngineEvents } from "@/server/risk/notifier";

/**
 * GET /api/v1/engine/sse
 * SSE endpoint for streaming auto-exit engine events and ticks to the frontend.
 *
 * Note: Next.js API routes use the Web Streams API for responses.
 */
export async function GET(_req: NextRequest) {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;
  const stream = new ReadableStream({
    start(controller) {
      // Send a comment to keep the connection alive
      controller.enqueue(encoder.encode(":ok\n\n"));

      // Subscribe to engine events
      unsubscribe = getEngineEvents((event) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      });
    },
    cancel() {
      // Called when client disconnects
      if (unsubscribe) unsubscribe();
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
