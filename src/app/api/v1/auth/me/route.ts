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
    const response = NextResponse.json(
      { error: "Session expired", detail: "Unknown or expired session — please sign in again" },
      { status: 401 },
    );
    response.cookies.delete("session_id");
    return response;
  }

  return NextResponse.json({
    clientCode: session.clientCode,
    name: `Client ${session.clientCode}`,
  });
}
