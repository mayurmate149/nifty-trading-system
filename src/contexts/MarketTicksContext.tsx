"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { scripToLabel } from "@/lib/xstream-constants";
import type { AutoExitStreamEvent } from "@/types/auto-exit-stream";
import type { MarketIndicators } from "@/types/market";
import { useAuth } from "@/app/providers/AuthProvider";

const RECONNECT_MS = 3_000;

export type XstreamConnectionState =
  | "disabled"
  | "connecting"
  | "open"
  | "closed"
  | "error";

export interface LiveIndexOverlay {
  spot?: number;
  spotPrevClose?: number;
  bankNifty?: number;
  bankNiftyPrevClose?: number;
  vix?: number;
}

type MsgTick = {
  type: "tick";
  token: number;
  lastRate: number;
  pClose: number;
};

type MsgStatus = { type: "status"; state: string };

type MsgSnapshot = {
  type: "snapshot";
  data: {
    positions: unknown;
    autoExit: unknown;
    indicators: MarketIndicators;
  };
};

type MsgAutoExitEvents = {
  type: "auto-exit-events";
  events: AutoExitStreamEvent[];
};

type GatewayMsg = MsgTick | MsgStatus | MsgSnapshot | MsgAutoExitEvents | { type: string };

function mapEventsForUi(events: unknown[]): AutoExitStreamEvent[] {
  const list = events.filter(
    (e) => e && typeof e === "object" && e !== null,
  ) as AutoExitStreamEvent[];
  return list
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 50);
}

function applyTick(prev: LiveIndexOverlay, t: MsgTick): LiveIndexOverlay {
  const label = scripToLabel(t.token);
  if (!label) return prev;
  if (label === "NIFTY") {
    return { ...prev, spot: t.lastRate, spotPrevClose: t.pClose };
  }
  if (label === "BANKNIFTY") {
    return { ...prev, bankNifty: t.lastRate, bankNiftyPrevClose: t.pClose };
  }
  if (label === "VIX") {
    return { ...prev, vix: t.pClose > 0 && t.lastRate < 1 ? t.pClose : t.lastRate };
  }
  return prev;
}

function mergeIndicators(
  base: MarketIndicators | null | undefined,
  live: LiveIndexOverlay,
): MarketIndicators | null {
  if (!base) return null;
  const hasLiveSpot = live.spot != null;
  const impliedPrev = base.spot - base.spotChange;
  const p = live.spotPrevClose ?? impliedPrev;
  const spot = hasLiveSpot ? (live.spot as number) : base.spot;
  const spotChange = hasLiveSpot
    ? Math.round((spot - p) * 100) / 100
    : base.spotChange;
  const spotChangePct = hasLiveSpot
    ? p > 0
      ? Math.round((spotChange / p) * 10000) / 100
      : 0
    : base.spotChangePct;
  return {
    ...base,
    vix: live.vix ?? base.vix,
    spot,
    spotChange,
    spotChangePct,
  };
}

/** Last tick per 5paisa token (indices + option scrips subscribed via `market-feed-subscribe`). */
export type TickByToken = Record<
  number,
  { lastRate?: number; pClose?: number; totalQty?: number; kind?: string; [k: string]: unknown }
>;

const MarketTicksContext = createContext<{
  connection: XstreamConnectionState;
  live: LiveIndexOverlay;
  applyLiveToIndicators: (i: MarketIndicators | null | undefined) => MarketIndicators | null;
  /** True after first { type: "snapshot" } on the WebSocket (positions + auto-exit + indicators from gateway). */
  hasTradingSnapshotOverWs: boolean;
  /** Auto-exit engine log, pushed as { type: "auto-exit-events" } from the gateway (replaces EventSource for that tab). */
  autoExitEventLog: AutoExitStreamEvent[];
  /** Live LTP/volume per ScripCode (token) from Xstream `MarketFeedV3`. */
  tickByToken: TickByToken;
  /** Send JSON to xstream-ws-gateway (e.g. `{ type: "market-feed-subscribe", instruments: [...] }`). */
  sendGatewayMessage: (msg: object) => void;
} | null>(null);

/** Pushes OAuth session token to xstream-ws-gateway so the feed can connect without static .env tokens. */
function XstreamGatewayRegister() {
  const { isAuthenticated, loading } = useAuth();
  const hasWs = Boolean(process.env.NEXT_PUBLIC_XSTREAM_WS_URL?.trim());
  useEffect(() => {
    if (!hasWs || loading || !isAuthenticated) return;
    void fetch("/api/v1/market/xstream-gateway/register", { method: "POST" });
  }, [hasWs, loading, isAuthenticated]);
  return null;
}

export function MarketTicksProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const url = process.env.NEXT_PUBLIC_XSTREAM_WS_URL?.trim() || "";
  const [connection, setConnection] = useState<XstreamConnectionState>(
    url ? "connecting" : "disabled",
  );
  const [live, setLive] = useState<LiveIndexOverlay>({});
  const [hasTradingSnapshotOverWs, setHasTradingSnapshotOverWs] = useState(false);
  const [autoExitEventLog, setAutoExitEventLog] = useState<AutoExitStreamEvent[]>([]);
  const [tickByToken, setTickByToken] = useState<TickByToken>({});
  const [retry, setRetry] = useState(0);

  const sendGatewayMessage = useCallback((msg: object) => {
    const w = wsRef.current;
    if (w && w.readyState === WebSocket.OPEN) {
      w.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    if (!url) {
      setConnection("disabled");
      return;
    }
    setConnection("connecting");
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnection("open");
    };
    ws.onclose = () => {
      wsRef.current = null;
      setConnection("closed");
      setHasTradingSnapshotOverWs(false);
      setAutoExitEventLog([]);
      setTickByToken({});
    };
    ws.onerror = () => {
      setConnection("error");
    };
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(String(ev.data)) as GatewayMsg;
        if (m.type === "tick" && "token" in m) {
          const tm = m as MsgTick & { token: number };
          setTickByToken((prev) => ({
            ...prev,
            [tm.token]: {
              lastRate: tm.lastRate,
              pClose: tm.pClose,
              totalQty: (m as { totalQty?: number }).totalQty,
              kind: (m as { kind?: string }).kind,
            },
          }));
          setLive((p) => applyTick(p, m as MsgTick));
        }
        if (m.type === "snapshot" && m && typeof m === "object" && "data" in m) {
          const raw = m as MsgSnapshot;
          setHasTradingSnapshotOverWs(true);
          queryClient.setQueryData(["tradingSnapshot"], raw.data);
          queryClient.setQueryData(["indicators"], raw.data.indicators);
        }
        if (m.type === "auto-exit-events" && m && typeof m === "object" && "events" in m) {
          const ev = m as MsgAutoExitEvents;
          setAutoExitEventLog(
            mapEventsForUi(
              Array.isArray(ev.events) ? ev.events : [],
            ),
          );
        }
        if (m.type === "status" && "state" in m) {
          const st = (m as MsgStatus).state;
          if (st === "ready" || st === "connecting" || st === "disconnected") {
            // optional: could set badge state
          }
        }
      } catch {
        // ignore
      }
    };
    return () => {
      wsRef.current = null;
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      try {
        ws.close();
      } catch {
        // ignore
      }
    };
  }, [url, retry, queryClient]);

  useEffect(() => {
    if (url && connection === "closed") {
      const t = setTimeout(() => setRetry((n) => n + 1), RECONNECT_MS);
      return () => clearTimeout(t);
    }
  }, [url, connection]);

  const applyLiveToIndicators = useCallback(
    (i: MarketIndicators | null | undefined) => mergeIndicators(i, live),
    [live],
  );

  const value = useMemo(
    () => ({
      connection: url ? connection : "disabled",
      live,
      applyLiveToIndicators,
      hasTradingSnapshotOverWs,
      autoExitEventLog,
      tickByToken,
      sendGatewayMessage,
    }),
    [
      url,
      connection,
      live,
      applyLiveToIndicators,
      hasTradingSnapshotOverWs,
      autoExitEventLog,
      tickByToken,
      sendGatewayMessage,
    ],
  );

  return (
    <MarketTicksContext.Provider value={value}>
      <XstreamGatewayRegister />
      {children}
    </MarketTicksContext.Provider>
  );
}

export function useMarketTicks() {
  return useContext(MarketTicksContext);
}
