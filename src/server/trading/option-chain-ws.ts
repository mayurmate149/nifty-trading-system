import type { OptionsChainResponse } from "@/types/market";
import type { MarketFeedInstrument } from "@/types/option-ws";

export type { MarketFeedInstrument };

/**
 * Derives 5paisa WebSocket `MarketFeedV3` subscription list from an options chain.
 * NSE index options use Exch `N`, segment `D` (derivatives) per Xstream docs.
 */
export function buildMarketFeedInstrumentsFromChain(
  chain: OptionsChainResponse,
): MarketFeedInstrument[] {
  const out: MarketFeedInstrument[] = [];
  const seen = new Set<number>();
  for (const row of chain.chain) {
    for (const side of [row.ce, row.pe] as const) {
      const sc = (side.scripCode ?? "").trim();
      if (!sc) continue;
      const n = parseInt(sc, 10);
      if (!Number.isFinite(n) || n <= 0 || seen.has(n)) continue;
      seen.add(n);
      out.push({ Exch: "N", ExchType: "D", ScripCode: n });
    }
  }
  return out;
}
