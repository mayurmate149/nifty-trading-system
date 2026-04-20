import { useEffect, useRef, useState } from "react";
import type { MarketIndicators } from "@/types/market";

/**
 * useMarketIndicatorsSSE — React hook for subscribing to live market indicators via SSE.
 * Usage:
 *   const indicators = useMarketIndicatorsSSE();
 */
export function useMarketIndicatorsSSE() {
  const [indicators, setIndicators] = useState<MarketIndicators | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/v1/market/indicators/sse");
    eventSourceRef.current = es;
    es.onmessage = (e) => {
      try {
        setIndicators(JSON.parse(e.data));
      } catch {}
    };
    es.onerror = () => {
      es.close();
    };
    return () => {
      es.close();
    };
  }, []);

  return indicators;
}
