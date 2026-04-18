import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/v1/logs/event
 * Client-side error/event reporting endpoint.
 */
export async function POST(request: NextRequest) {
  const body = await request.json();

  // TODO: Phase 8 — Persist to DB via logging module
  console.log(`[LOG EVENT] ${body.type}:`, JSON.stringify(body.data));

  return NextResponse.json({ success: true });
}
