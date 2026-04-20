import { useEffect, useRef, useState } from "react";
import type { OptionsChainResponse } from "@/types/market";

/**
 * useOptionsChainSSE — React hook for subscribing to live options chain via SSE.
 * Usage:
 *   const chain = useOptionsChainSSE(symbol);
 */
export function useOptionsChainSSE(symbol: string, expiry = "") {
  const [chain, setChain] = useState<OptionsChainResponse | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!symbol) return;
    const url = `/api/v1/market/options-chain/sse?symbol=${encodeURIComponent(symbol)}${expiry ? `&expiry=${encodeURIComponent(expiry)}` : ""}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;
    es.onmessage = (e) => {
      try {
        setChain(JSON.parse(e.data));
      } catch {}
    };
    es.onerror = () => {
      es.close();
    };
    return () => {
      es.close();
    };
  }, [symbol, expiry]);

  return chain;
}
