import { useEffect, useRef, useState } from "react";

/**
 * useAnalyticsSummarySSE — React hook for subscribing to live analytics summary via SSE.
 * Usage:
 *   const analytics = useAnalyticsSummarySSE(section);
 */
export function useAnalyticsSummarySSE(section: string = "all") {
  const [data, setData] = useState<any>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const url = `/api/v1/analytics/summary/sse?section=${encodeURIComponent(section)}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;
    es.onmessage = (e) => {
      try {
        setData(JSON.parse(e.data));
      } catch {}
    };
    es.onerror = () => {
      es.close();
    };
    return () => {
      es.close();
    };
  }, [section]);

  return data;
}
