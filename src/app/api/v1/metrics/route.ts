import { NextResponse } from "next/server";

// In-memory metrics store (singleton)

type Metrics = {
  wsTicksDelivered: number;
  wsReconnects: number;
  sseMessages: Record<string, number>;
  sseErrors: Record<string, number>;
  lastTickTimestamp: number;
  lastSSEMessage: Record<string, number>;
};


declare global {
  // eslint-disable-next-line no-var
  var __METRICS__: Metrics | undefined;
}

const metrics: Metrics = global.__METRICS__ || {
  wsTicksDelivered: 0,
  wsReconnects: 0,
  sseMessages: {},
  sseErrors: {},
  lastTickTimestamp: 0,
  lastSSEMessage: {},
};
global.__METRICS__ = metrics;

/**
 * GET /api/v1/metrics
 * Returns basic server-side metrics for health and lag diagnostics.
 */
export async function GET() {
  return NextResponse.json({
    ...metrics,
    now: new Date().toISOString(),
  });
}
