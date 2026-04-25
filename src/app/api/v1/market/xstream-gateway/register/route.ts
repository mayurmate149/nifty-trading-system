import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/server/middleware/auth";

/**
 * POST /api/v1/market/xstream-gateway/register
 * Pushes the current 5paisa OAuth access token + client code to xstream-ws-gateway
 * so the WebSocket feed can connect without static FIVEPAISA_ACCESS_TOKEN in .env.
 */
export async function POST(request: NextRequest) {
  return withAuth(request, async (req, session) => {
    if (process.env.USE_SIMULATOR === "true") {
      return NextResponse.json({ ok: true, skipped: "simulator" });
    }
    const base = (process.env.XSTREAM_GATEWAY_URL || "http://127.0.0.1:3333").replace(
      /\/$/,
      "",
    );
    const secret = process.env.XSTREAM_GATEWAY_SECRET?.trim() || "";
    const sessionId = req.cookies.get("session_id")?.value;
    const res = await fetch(`${base}/configure`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "x-gateway-secret": secret } : {}),
      },
      body: JSON.stringify({
        accessToken: session.accessToken,
        clientCode: session.clientCode,
        ...(sessionId ? { sessionId } : {}),
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      return NextResponse.json(
        { error: "gateway_configure_failed", detail: t.slice(0, 300) },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true });
  });
}
