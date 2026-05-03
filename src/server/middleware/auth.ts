/**
 * Auth Middleware
 *
 * Protects API routes by verifying the session cookie.
 * Attaches AuthSession to the request context.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/server/auth";

export async function withAuth(
  request: NextRequest,
  handler: (req: NextRequest, session: any) => Promise<NextResponse>
): Promise<NextResponse> {
  const sessionId = request.cookies.get("session_id")?.value;

  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized", detail: "No session cookie" }, { status: 401 });
  }

  const session = await verifySession(sessionId);
  if (!session) {
    console.warn(
      "[AUTH MW] Invalid or stale session cookie (often after server restart — sign in again):",
      sessionId,
    );
    const response = NextResponse.json(
      { error: "Session expired", detail: "Unknown or expired session — please sign in again" },
      { status: 401 },
    );
    response.cookies.delete("session_id");
    return response;
  }

  return handler(request, session);
}
