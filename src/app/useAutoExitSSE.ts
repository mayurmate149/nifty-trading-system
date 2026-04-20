import { useEffect, useRef, useState } from "react";

/**
 * useAutoExitSSE — React hook for subscribing to live auto-exit engine status via SSE.
 * Usage:
 *   const autoExit = useAutoExitSSE();
 */
export function useAutoExitSSE() {
  const [data, setData] = useState<any>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/v1/auto-exit/sse");
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
  }, []);

  return data;
}
