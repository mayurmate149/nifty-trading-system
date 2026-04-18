import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/server/auth";
import { getEvents, addSSEClient, removeSSEClient, AutoExitEvent } from "@/server/risk/notifier";

/**
 * GET /api/v1/auto-exit/events
 *
 * Server-Sent Events (SSE) stream for auto-exit events.
 * Frontend connects with EventSource and receives real-time updates.
 *
 * Query params:
 *   ?since=<timestamp>  — only return events after this timestamp (for initial load)
 *   ?poll=true          — return JSON array instead of SSE (for polling fallback)
 *
 * NOTE: We don't use withAuth() here because SSE needs to return a raw Response,
 * not NextResponse. We manually verify the session from the cookie.
 */
export async function GET(request: NextRequest) {
  // Manual auth check (SSE can't use withAuth which expects NextResponse)
  const sessionId = request.cookies.get("session_id")?.value;
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const session = await verifySession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session expired" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const since = searchParams.get("since");
  const poll = searchParams.get("poll");

    // Polling fallback — return JSON array
    if (poll === "true") {
      const events = getEvents(since ? parseInt(since) : undefined);
      return new Response(JSON.stringify({ events }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // SSE stream
    const encoder = new TextEncoder();
    let closed = false;

    const stream = new ReadableStream({
      start(controller) {
        // Send existing events first (if since param provided)
        const existing = getEvents(since ? parseInt(since) : undefined);
        for (const event of existing) {
          if (closed) return;
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        }

        // Register SSE listener for new events
        const listener = (event: AutoExitEvent) => {
          if (closed) return;
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
            );
          } catch {
            closed = true;
            removeSSEClient(listener);
          }
        };

        addSSEClient(listener);

        // Send heartbeat every 15s to keep connection alive
        const heartbeat = setInterval(() => {
          if (closed) {
            clearInterval(heartbeat);
            return;
          }
          try {
            controller.enqueue(encoder.encode(`: heartbeat\n\n`));
          } catch {
            closed = true;
            clearInterval(heartbeat);
            removeSSEClient(listener);
          }
        }, 15000);

        // Cleanup when client disconnects
        request.signal.addEventListener("abort", () => {
          closed = true;
          clearInterval(heartbeat);
          removeSSEClient(listener);
          try { controller.close(); } catch { /* already closed */ }
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
}
