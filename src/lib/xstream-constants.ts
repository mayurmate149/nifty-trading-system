/** 5paisa NSE index scrip codes (Scrip master) — used with MarketFeedV3. */
export const NIFTY_SCRIP_CODE = 999920000;
export const BANKNIFTY_SCRIP_CODE = 999920005;
export const VIX_SCRIP_CODE = 999920019;

/** Xstream openfeed WebSocket path (5paisa docs: query Value1=accessToken|clientCode). */
export const XSTREAM_OPENFEED_PATH = "feeds/api/chat" as const;

export function scripToLabel(
  token: number,
): "NIFTY" | "BANKNIFTY" | "VIX" | null {
  if (token === NIFTY_SCRIP_CODE) return "NIFTY";
  if (token === BANKNIFTY_SCRIP_CODE) return "BANKNIFTY";
  if (token === VIX_SCRIP_CODE) return "VIX";
  return null;
}
