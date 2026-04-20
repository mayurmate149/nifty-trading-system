import { useEffect, useRef, useState } from "react";

/**
 * useEngineEvents — React hook for subscribing to engine/tick events via SSE.
 * Usage:
 *   const events = useEngineEvents();
 */
export function useEngineEvents() {
  const [events, setEvents] = useState<any[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/v1/engine/sse");
    eventSourceRef.current = es;
    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data);
        setEvents((prev) => [...prev.slice(-199), evt]);
      } catch {}
    };
    es.onerror = () => {
      es.close();
    };
    return () => {
      es.close();
    };
  }, []);

  return events;
}
