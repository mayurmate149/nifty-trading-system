/**
 * Market Data — WebSocket Client
 *
 * Connects to 5paisa Xstream WebSocket for live market feed.
 * Parses ticks and updates in-memory cache.
 */


import type { MarketTick } from "../../types/market";
// Metrics singleton
const metrics = (global as any).__METRICS__ || ((global as any).__METRICS__ = {
  wsTicksDelivered: 0,
  wsReconnects: 0,
  sseMessages: {},
  sseErrors: {},
  lastTickTimestamp: 0,
  lastSSEMessage: {},
});

function logWS(msg: string) {
  // eslint-disable-next-line no-console
  console.log(`[WS] ${msg}`);
}

const XSTREAM_WS_URL = "wss://openfeed.5paisa.com/Feeds/api/chat";

export class XstreamWSClient {
  private ws: WebSocket | null = null;
  private subscriptions: Set<string> = new Set();
  private onTickCallbacks: ((tick: MarketTick) => void)[] = [];
  offTick(callback: (tick: MarketTick) => void): void {
    this.onTickCallbacks = this.onTickCallbacks.filter((cb) => cb !== callback);
  }
  private reconnectAttempts = 0;

  constructor(private accessToken: string) {}


  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.ws = new WebSocket(XSTREAM_WS_URL);
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      logWS('WebSocket connected');
      // Send handshake/auth message
      const authMsg = {
        Method: "login",
        Token: this.accessToken,
        APP_SOURCE: "WEB",
      };
      this.ws?.send(JSON.stringify(authMsg));
      // Subscribe to any pre-added instruments
      if (this.subscriptions.size > 0) {
        this.subscribe(Array.from(this.subscriptions));
      }
    };
    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // Tick message: { Method: "tick", ... }
        if (data.Method === "tick" && data.Data) {
          const tick: MarketTick = {
            symbol: data.Data.Symbol,
            ltp: data.Data.LastRate,
            volume: data.Data.Qty,
            oi: data.Data.OpenInterest,
            timestamp: Date.now(),
          };
          metrics.wsTicksDelivered++;
          metrics.lastTickTimestamp = tick.timestamp;
          logWS(`Tick delivered: ${tick.symbol} LTP=${tick.ltp}`);
          this.onTickCallbacks.forEach((cb) => cb(tick));
        }
        // Handle other message types as needed
      } catch (e) {
        logWS('Error parsing WS message');
      }
    };
    this.ws.onclose = () => {
      metrics.wsReconnects++;
      logWS('WebSocket closed, reconnecting...');
      // Exponential backoff for reconnection
      this.reconnectAttempts++;
      const delay = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempts));
      setTimeout(() => this.connect(), delay);
    };
    this.ws.onerror = (err) => {
      logWS('WebSocket error, closing connection');
      this.ws?.close();
    };
  }

  subscribe(instruments: string[]): void {
    instruments.forEach((i) => this.subscriptions.add(i));
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const subMsg = {
        Method: "subscribe",
        Instruments: instruments,
      };
      this.ws.send(JSON.stringify(subMsg));
    }
  }

  unsubscribe(instruments: string[]): void {
    instruments.forEach((i) => this.subscriptions.delete(i));
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const unsubMsg = {
        Method: "unsubscribe",
        Instruments: instruments,
      };
      this.ws.send(JSON.stringify(unsubMsg));
    }
  }

  isConnected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  onTick(callback: (tick: MarketTick) => void): void {
    this.onTickCallbacks.push(callback);
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.reconnectAttempts = 0;
  }

  /**
   * Usage:
   *   const ws = new XstreamWSClient(accessToken);
   *   ws.connect();
   *   ws.subscribe(["NIFTY", "BANKNIFTY"]);
   *   ws.onTick((tick) => { ... });
   *   // ...
   *   ws.disconnect();
   */
}
