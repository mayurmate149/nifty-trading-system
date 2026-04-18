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

  console.log("[AUTH MW] Cookie 'session_id':", sessionId ?? "NOT FOUND");
  console.log("[AUTH MW] All cookies:", request.cookies.getAll().map(c => c.name).join(", ") || "NONE");

  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized", detail: "No session cookie" }, { status: 401 });
  }

  const session = await verifySession(sessionId);
  if (!session) {
    console.log("[AUTH MW] Session not found in store for id:", sessionId);
    return NextResponse.json({ error: "Session expired" }, { status: 401 });
  }

  console.log("[AUTH MW] Session verified for client:", session.clientCode);
  return handler(request, session);
}
