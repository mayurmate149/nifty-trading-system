import { NextRequest, NextResponse } from "next/server";
import { exchangeToken } from "@/server/auth";

/**
 * POST /api/v1/auth/login
 * Exchanges 5paisa requestToken for accessToken (server-side).
 * Sets session cookie.
 */
export async function POST(request: NextRequest) {
  try {
    const { requestToken, redirectUri } = await request.json();

    const session = await exchangeToken({ requestToken, redirectUri });

    const response = NextResponse.json({
      success: true,
      clientCode: session.clientCode,
      expiresAt: session.expiresAt.toISOString(),
    });

    // Set HTTP-only session cookie
    response.cookies.set("session_id", session.userId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8, // 8 hours
    });

    return response;
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 401 }
    );
  }
}
