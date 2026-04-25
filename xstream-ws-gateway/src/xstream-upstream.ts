import WebSocket from "ws";
import { buildXstreamWebSocketUrl } from "./feed-host.js";
import {
  parse5paisaPayload,
  toGatewayTick,
  DEFAULT_SUBSCRIPTIONS,
  mergeWithDefaultSubscriptions,
} from "./parsers.js";

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;

type ClientListener = (message: string) => void;
type StateListener = (state: UpstreamState) => void;

export type UpstreamState = "disconnected" | "connecting" | "ready" | "error" | "unconfigured";

let ws: WebSocket | null = null;
let upstreamState: UpstreamState = "unconfigured";
const clientListeners = new Set<ClientListener>();
const stateListeners = new Set<StateListener>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;
let lastAccess = "";
let lastClientCode = "";
let subOverride: { Exch: string; ExchType: string; ScripCode: number }[] = DEFAULT_SUBSCRIPTIONS;
let lastSubscribedSnapshot: { Exch: string; ExchType: string; ScripCode: number }[] = [];

function setState(s: UpstreamState) {
  if (s === upstreamState) return;
  upstreamState = s;
  stateListeners.forEach((fn) => fn(s));
  broadcastToBrowserClients(
    JSON.stringify({ type: "status", state: s, at: new Date().toISOString() }),
  );
}

/** All browser tabs connected to the gateway receive these messages (ticks, snapshot, status). */
export function broadcastToBrowserClients(msg: string) {
  clientListeners.forEach((fn) => {
    try {
      fn(msg);
    } catch {
      // ignore
    }
  });
}

function subscribeMarket(clientCode: string) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const payload = {
    Method: "MarketFeedV3",
    Operation: "Subscribe",
    ClientCode: clientCode,
    MarketFeedData: subOverride,
  };
  ws.send(JSON.stringify(payload));
  lastSubscribedSnapshot = subOverride.map((x) => ({ ...x }));
}

export function getLastClientCode(): string {
  return lastClientCode;
}

/**
 * Live subscription update from browser (see gateway WebSocket `market-feed-subscribe`).
 * Unsubscribes previous set, then subscribes merged defaults + F&O scrips.
 */
export function applyMarketFeedSubscriptions(
  clientCode: string,
  extra: { Exch: string; ExchType: string; ScripCode: number }[],
) {
  const merged = mergeWithDefaultSubscriptions(extra);
  const code = (clientCode || lastClientCode).trim();
  if (!code) return;
  if (!lastAccess) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    subOverride = merged;
    return;
  }
  if (lastSubscribedSnapshot.length > 0) {
    ws.send(
      JSON.stringify({
        Method: "MarketFeedV3",
        Operation: "Unsubscribe",
        ClientCode: code,
        MarketFeedData: lastSubscribedSnapshot,
      }),
    );
  }
  subOverride = merged;
  subscribeMarket(code);
}

export function getUpstreamState(): UpstreamState {
  return upstreamState;
}

export function hasSessionCredentials(): boolean {
  return Boolean(lastAccess && lastClientCode);
}

export function onUpstreamState(fn: StateListener) {
  stateListeners.add(fn);
  return () => void stateListeners.delete(fn);
}

export function onUpstreamMessage(fn: ClientListener) {
  clientListeners.add(fn);
  return () => void clientListeners.delete(fn);
}

export function configureAndConnect(params: {
  accessToken: string;
  clientCode: string;
  instruments?: { Exch: string; ExchType: string; ScripCode: number }[];
}) {
  if (params.instruments?.length) {
    subOverride = mergeWithDefaultSubscriptions(params.instruments);
  } else {
    subOverride = DEFAULT_SUBSCRIPTIONS;
  }
  lastSubscribedSnapshot = [];
  const nextToken = params.accessToken.trim();
  const nextCode = params.clientCode.trim();
  if (!nextToken || !nextCode) {
    setState("unconfigured");
    return;
  }
  lastAccess = nextToken;
  lastClientCode = nextCode;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  connectNow();
}

function connectNow() {
  if (!lastAccess || !lastClientCode) {
    setState("unconfigured");
    return;
  }
  if (ws) {
    try {
      ws.terminate();
    } catch {
      // ignore
    }
    ws = null;
  }
  setState("connecting");
  const url = buildXstreamWebSocketUrl(lastAccess, lastClientCode);
  const socket = new WebSocket(url, { perMessageDeflate: false });
  ws = socket;

  socket.on("open", () => {
    setState("ready");
    attempt = 0;
    subscribeMarket(lastClientCode);
  });

  socket.on("message", (data: WebSocket.RawData) => {
    const raw = data.toString();
    for (const row of parse5paisaPayload(raw)) {
      const t = toGatewayTick(row);
      if (t) {
        broadcastToBrowserClients(JSON.stringify(t));
      }
    }
  });

  socket.on("close", () => {
    setState("disconnected");
    scheduleReconnect();
  });

  socket.on("error", () => {
    setState("error");
  });
}

function scheduleReconnect() {
  if (!lastAccess || !lastClientCode) return;
  if (reconnectTimer) return;
  attempt += 1;
  const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.min(attempt, 6));
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectNow();
  }, delay);
}

export function stopUpstream() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  lastAccess = "";
  lastClientCode = "";
  lastSubscribedSnapshot = [];
  if (ws) {
    try {
      ws.removeAllListeners();
      ws.close();
    } catch {
      // ignore
    }
    ws = null;
  }
  setState("unconfigured");
}
