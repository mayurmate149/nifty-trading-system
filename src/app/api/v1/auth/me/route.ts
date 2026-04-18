import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/server/auth";

/**
 * GET /api/v1/auth/me
 * Returns current user info from session.
 */
export async function GET(request: NextRequest) {
  const sessionId = request.cookies.get("session_id")?.value;
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await verifySession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session expired" }, { status: 401 });
  }

  return NextResponse.json({
    clientCode: session.clientCode,
    name: `Client ${session.clientCode}`,
  });
}
