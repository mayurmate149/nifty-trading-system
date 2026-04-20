import { useEffect, useRef, useState } from "react";

/**
 * usePositionsSSE — React hook for subscribing to live positions/margin via SSE.
 * Usage:
 *   const { positions, margin } = usePositionsSSE();
 */
export function usePositionsSSE() {
  const [positions, setPositions] = useState<any[]>([]);
  const [margin, setMargin] = useState<any>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/v1/positions/sse");
    eventSourceRef.current = es;
    es.onmessage = (e) => {
      try {
        const { positions, margin } = JSON.parse(e.data);
        setPositions(positions || []);
        setMargin(margin || null);
      } catch {}
    };
    es.onerror = () => {
      es.close();
    };
    return () => {
      es.close();
    };
  }, []);

  return { positions, margin };
}
