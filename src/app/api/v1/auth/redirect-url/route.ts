import { NextResponse } from "next/server";
import { getOAuthRedirectUrl } from "@/server/auth";

/**
 * GET /api/v1/auth/redirect-url
 * Returns the 5paisa OAuth URL to redirect the user to.
 */
export async function GET() {
  const url = getOAuthRedirectUrl();
  return NextResponse.json({ url });
}
