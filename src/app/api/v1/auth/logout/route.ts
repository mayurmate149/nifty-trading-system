import { NextResponse } from "next/server";
import { destroySession } from "@/server/auth";
import { NextRequest } from "next/server";

/**
 * POST /api/v1/auth/logout
 * Clears session and cookie.
 */
export async function POST(request: NextRequest) {
  const sessionId = request.cookies.get("session_id")?.value;

  if (sessionId) {
    try {
      await destroySession(sessionId);
    } catch {
      // Ignore — session may already be expired
    }
  }

  const response = NextResponse.json({ success: true });
  response.cookies.delete("session_id");
  return response;
}
