/**
 * Register an SSE listener and return an unsubscribe function.
 */
export function getEngineEvents(listener: (event: AutoExitEvent) => void): () => void {
  addSSEClient(listener);
  return () => removeSSEClient(listener);
}
/**
 * Notifier Module — Phase 5
 *
 * Central event system for auto-exit engine:
 *   - In-memory event log (ring buffer, last 200 events)
 *   - SSE (Server-Sent Events) push to connected frontend clients
 *   - Console logging
 *   - (Optional) Telegram webhook
 */

// ─── Types ───────────────────────────────────

export interface Notification {
  type: "EXIT_TRIGGER" | "TRAIL_UPDATE" | "ERROR" | "INFO";
  title: string;
  message: string;
  data?: Record<string, any>;
}

export interface AutoExitEvent {
  type: string;        // STOP_LOSS, TAKE_PROFIT, BREAKEVEN, TRAIL_UPDATE, WATCH_STARTED, etc.
  positionId: string;
  message: string;
  timestamp: number;
  data?: Record<string, any>;
}

// ─── Persist across HMR ──────────────────────

const g = globalThis as unknown as {
  __autoExitEvents?: AutoExitEvent[];
  __autoExitSSEClients?: Set<(event: AutoExitEvent) => void>;
};

if (!g.__autoExitEvents) g.__autoExitEvents = [];
if (!g.__autoExitSSEClients) g.__autoExitSSEClients = new Set();

const MAX_EVENTS = 200;

// ─── Event Log ───────────────────────────────

export function pushEvent(event: AutoExitEvent): void {
  g.__autoExitEvents!.push(event);
  if (g.__autoExitEvents!.length > MAX_EVENTS) {
    g.__autoExitEvents!.shift();
  }

  // Console log
  const ts = new Date(event.timestamp).toLocaleTimeString();
  console.log(`[NOTIFY ${ts}] ${event.type}: ${event.message}`);

  // Push to all SSE clients
  for (const listener of Array.from(g.__autoExitSSEClients!)) {
    try {
      listener(event);
    } catch {
      g.__autoExitSSEClients!.delete(listener);
    }
  }
}

export function getEvents(since?: number): AutoExitEvent[] {
  if (since) {
    return g.__autoExitEvents!.filter((e) => e.timestamp > since);
  }
  return [...g.__autoExitEvents!];
}

export function clearEvents(): void {
  g.__autoExitEvents!.length = 0;
}

// ─── SSE Client Management ───────────────────

export function addSSEClient(listener: (event: AutoExitEvent) => void): void {
  g.__autoExitSSEClients!.add(listener);
}

export function removeSSEClient(listener: (event: AutoExitEvent) => void): void {
  g.__autoExitSSEClients!.delete(listener);
}

export function getSSEClientCount(): number {
  return g.__autoExitSSEClients!.size;
}

// ─── Send Notification (high-level) ──────────

export async function sendNotification(notification: Notification): Promise<void> {
  console.log(`[NOTIFY] ${notification.type}: ${notification.title} — ${notification.message}`);

  // Push as event too (so SSE clients receive it)
  pushEvent({
    type: notification.type,
    positionId: notification.data?.positionId || "",
    message: `${notification.title}: ${notification.message}`,
    timestamp: Date.now(),
    data: notification.data,
  });

  // (Optional) Telegram webhook
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;
  if (telegramBotToken && telegramChatId) {
    try {
      await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: telegramChatId,
          text: `🤖 *${notification.title}*\n${notification.message}`,
          parse_mode: "Markdown",
        }),
      });
    } catch (err: any) {
      console.error("[NOTIFY] Telegram send failed:", err.message);
    }
  }
}
