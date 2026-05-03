/**
 * Auth Module
 *
 * Handles 5paisa OAuth flow:
 * 1. Generate redirect URL to 5paisa login
 * 2. Exchange requestToken for accessToken (server-side)
 * 3. Store session in-memory (server only)
 * 4. Issue HTTP-only cookie with session ID
 * 5. Verify session on protected routes
 */

import { AuthSession, LoginRequest } from "@/types/auth";
import { getSimulatorHttpBase, useSimulatorTrading } from "@/server/env/trading-mode";
import crypto from "crypto";

// ─── In-Memory Session Store ─────────────────
// Attach to globalThis so sessions survive Next.js HMR / hot-reloads in dev mode.
// In production there is no HMR, so this is a no-op.
const globalForSessions = globalThis as unknown as {
  __sessions?: Map<string, AuthSession>;
};

if (!globalForSessions.__sessions) {
  globalForSessions.__sessions = new Map<string, AuthSession>();
}

const sessions = globalForSessions.__sessions;

// ─── Simulator vs Real 5paisa Toggle ─────────
const USE_SIMULATOR = useSimulatorTrading();
const SIMULATOR_HTTP_BASE = getSimulatorHttpBase(USE_SIMULATOR);

if (USE_SIMULATOR) {
  console.log("[AUTH] 🎮 SIMULATOR MODE — using mock server at", SIMULATOR_HTTP_BASE);
} else {
  console.log("[AUTH] 🔴 LIVE MODE — using real 5paisa APIs");
}

const FIVEPAISA_LOGIN_URL = USE_SIMULATOR
  ? `${SIMULATOR_HTTP_BASE}/WebVendorLogin/VLogin/Index`
  : "https://dev-openapi.5paisa.com/WebVendorLogin/VLogin/Index";

const FIVEPAISA_TOKEN_URL = USE_SIMULATOR
  ? `${SIMULATOR_HTTP_BASE}/VendorsAPI/Service1.svc/GetAccessToken`
  : "https://Openapi.5paisa.com/VendorsAPI/Service1.svc/GetAccessToken";

export function getOAuthRedirectUrl(): string {
  const vendorKey = process.env.FIVEPAISA_APP_KEY;
  const responseURL = process.env.FIVEPAISA_OAUTH_REDIRECT_URI;

  if (!vendorKey) {
    throw new Error("FIVEPAISA_APP_KEY is not set in environment variables");
  }
  if (!responseURL) {
    throw new Error("FIVEPAISA_OAUTH_REDIRECT_URI is not set in environment variables");
  }

  const params = new URLSearchParams({
    VendorKey: vendorKey,
    ResponseURL: responseURL,
  });
  return `${FIVEPAISA_LOGIN_URL}?${params.toString()}`;
}

export async function exchangeToken(req: LoginRequest): Promise<AuthSession> {
  const appKey = process.env.FIVEPAISA_APP_KEY;
  const userId = process.env.FIVEPAISA_USER_ID;
  const encryKey = process.env.FIVEPAISA_ENCRY_KEY;

  if (!appKey || !userId || !encryKey) {
    throw new Error("5paisa API credentials not configured");
  }

  // Exact payload format from official 5paisa JS SDK (ACCESS_TOKEN_PAYLOAD)
  const payload = {
    head: {
      Key: appKey,
    },
    body: {
      RequestToken: req.requestToken,
      EncryKey: encryKey,
      UserId: userId,
    },
  };

  console.log("[AUTH] Exchanging RequestToken with 5paisa...");
  console.log("[AUTH] Token URL:", FIVEPAISA_TOKEN_URL);
  console.log("[AUTH] Payload:", JSON.stringify(payload, null, 2));

  const response = await fetch(FIVEPAISA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("[AUTH] 5paisa API HTTP error:", response.status, text);
    throw new Error(`5paisa API returned ${response.status}`);
  }

  const data = await response.json();
  console.log("[AUTH] 5paisa response:", JSON.stringify(data, null, 2));

  // 5paisa returns body.ClientCode and body.AccessToken on success
  const body = data.body;

  if (!body || body.ClientCode === "ABORTING" || body.ClientCode === "" || !body.AccessToken) {
    const msg = body?.Message || body?.Status?.toString() || "Unknown error";
    console.error("[AUTH] Token exchange failed:", msg);
    throw new Error(`5paisa auth failed: ${msg}`);
  }

  // Create session
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 8); // 8-hour session

  const session: AuthSession = {
    userId: sessionId,
    clientCode: body.ClientCode,
    accessToken: body.AccessToken,
    expiresAt,
  };

  sessions.set(sessionId, session);
  console.log(`[AUTH] Session created for client ${body.ClientCode} (session: ${sessionId})`);

  return session;
}

export async function verifySession(sessionId: string): Promise<AuthSession | null> {
  const session = sessions.get(sessionId);
  if (!session) {
    return null;
  }

  // Check expiry
  if (new Date() > session.expiresAt) {
    sessions.delete(sessionId);
    console.log(`[AUTH] Session expired: ${sessionId}`);
    return null;
  }

  return session;
}

export async function destroySession(sessionId: string): Promise<void> {
  sessions.delete(sessionId);
  console.log(`[AUTH] Session destroyed: ${sessionId}`);
}

/**
 * Get the access token for a given session (used by broker-proxy)
 */
export async function getAccessTokenForSession(sessionId: string): Promise<string | null> {
  const session = await verifySession(sessionId);
  return session?.accessToken ?? null;
}
