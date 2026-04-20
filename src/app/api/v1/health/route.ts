import { NextResponse } from "next/server";

/**
 * GET /api/v1/health
 * Health check endpoint: DB, 5paisa API, WebSocket status.
 */
export async function GET() {
  // Metrics singleton
  const metrics = (global as any).__METRICS__ || ((global as any).__METRICS__ = {
    wsTicksDelivered: 0,
    wsReconnects: 0,
    sseMessages: {},
    sseErrors: {},
    lastTickTimestamp: 0,
    lastSSEMessage: {},
  });

  // WebSocket health: consider healthy if ticks delivered in last 10s
  const now = Date.now();
  const wsHealthy = metrics.lastTickTimestamp && (now - metrics.lastTickTimestamp < 10000);

  // SSE health: healthy if any endpoint sent a message in last 10s
  const sseHealthy = Object.values(metrics.lastSSEMessage).some(ts => now - (ts as number) < 10000);

  return NextResponse.json({
    status: wsHealthy && sseHealthy ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    checks: {
      database: "unknown", // TODO: implement DB ping if needed
      brokerApi: "unknown", // TODO: implement broker API ping if needed
      webSocket: wsHealthy ? "ok" : "lagging",
      sse: sseHealthy ? "ok" : "lagging",
    },
    metrics: {
      wsTicksDelivered: metrics.wsTicksDelivered,
      wsReconnects: metrics.wsReconnects,
      sseMessages: metrics.sseMessages,
      sseErrors: metrics.sseErrors,
      lastTickTimestamp: metrics.lastTickTimestamp,
      lastSSEMessage: metrics.lastSSEMessage,
    },
  });
}
