import { broadcastToBrowserClients } from "./xstream-upstream.js";

/**
 * Polls the Next.js app and pushes to browsers over the same WebSocket as 5paisa ticks:
 * - { type: "snapshot" }     → positions + auto-exit + indicators
 * - { type: "auto-exit-events" } → auto-exit engine log (replaces per-tab SSE)
 *
 * Requires sessionId from POST /configure (forwarded from Next after login).
 */

const NEXT_URL = (process.env.NEXT_APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const INTERVAL_MS = Number(process.env.TRADING_SNAPSHOT_INTERVAL_MS || 2500);

let pollTimer: ReturnType<typeof setInterval> | null = null;
let sessionCookie: string | null = null;

export function setTradingSessionCookie(sessionId: string | null) {
  stopTradingSnapshotPoll();
  sessionCookie = sessionId?.trim() || null;
  if (!sessionCookie) {
    return;
  }
  void pollOnce();
  pollTimer = setInterval(() => void pollOnce(), INTERVAL_MS);
}

export function stopTradingSnapshotPoll() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function pollOnce() {
  if (!sessionCookie) return;
  const headers: Record<string, string> = {
    cookie: `session_id=${sessionCookie}`,
  };
  const base = `${NEXT_URL}`;
  try {
    const [rSnap, rEv] = await Promise.all([
      fetch(`${base}/api/v1/trading/snapshot`, { headers }),
      fetch(`${base}/api/v1/auto-exit/events?poll=true`, { headers }),
    ]);
    if (rSnap.ok) {
      const data = await rSnap.json();
      broadcastToBrowserClients(
        JSON.stringify({
          type: "snapshot",
          data,
          at: new Date().toISOString(),
        }),
      );
    }
    if (rEv.ok) {
      const j = (await rEv.json()) as { events?: unknown[] };
      const events = Array.isArray(j?.events) ? j.events : [];
      broadcastToBrowserClients(
        JSON.stringify({
          type: "auto-exit-events",
          events,
          at: new Date().toISOString(),
        }),
      );
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[xstream-ws-gateway] realtime bundle poll failed", e);
  }
}
