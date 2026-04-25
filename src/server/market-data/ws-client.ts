/**
 * Market Data — WebSocket (5paisa Xstream)
 *
 * Live ticks are relayed by `xstream-ws-gateway/` (Express + ws). It connects to
 * `wss://…/feeds/api/chat` with `MarketFeedV3` as documented.
 * The Next.js app consumes the gateway in the browser via `NEXT_PUBLIC_XSTREAM_WS_URL`
 * and `src/contexts/MarketTicksContext.tsx`.
 *
 * @see https://xstream.5paisa.com/dev-docs/market-data-system/web-socket
 */
export { XSTREAM_OPENFEED_PATH } from "@/lib/xstream-constants";
