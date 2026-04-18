/**
 * Market Data — WebSocket Client
 *
 * Connects to 5paisa Xstream WebSocket for live market feed.
 * Parses ticks and updates in-memory cache.
 */

import { MarketTick } from "@/types/market";

const XSTREAM_WS_URL = "wss://openfeed.5paisa.com/Feeds/api/chat";

export class XstreamWSClient {
  private ws: WebSocket | null = null;
  private subscriptions: Set<string> = new Set();
  private onTickCallbacks: ((tick: MarketTick) => void)[] = [];

  constructor(private accessToken: string) {}

  connect(): void {
    // TODO: Phase 3
    // 1. Open WebSocket to XSTREAM_WS_URL
    // 2. Send auth handshake with accessToken
    // 3. On message → parse → call onTickCallbacks
    // 4. Handle reconnection with exponential backoff
    throw new Error("Not implemented — Phase 3");
  }

  subscribe(instruments: string[]): void {
    // TODO: Phase 3
    // Send subscription message for instruments (e.g., "NIFTY", "BANKNIFTY", options)
    instruments.forEach((i) => this.subscriptions.add(i));
    throw new Error("Not implemented — Phase 3");
  }

  onTick(callback: (tick: MarketTick) => void): void {
    this.onTickCallbacks.push(callback);
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }
}
