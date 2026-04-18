import { NextResponse } from "next/server";

/**
 * GET /api/v1/health
 * Health check endpoint: DB, 5paisa API, WebSocket status.
 */
export async function GET() {
  // TODO: Phase 8 — Check DB ping, 5paisa API, WS connection
  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    checks: {
      database: "unknown",
      brokerApi: "unknown",
      webSocket: "unknown",
    },
  });
}
