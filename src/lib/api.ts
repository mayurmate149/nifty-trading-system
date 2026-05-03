/**
 * Frontend API Abstraction
 *
 * Centralized API client for all internal REST endpoints.
 * Used by React Query hooks across pages.
 */

const API_BASE = "/api/v1";

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: "Request failed" }));
    throw new Error(error.message || `API error ${res.status}`);
  }

  return res.json();
}

// ─── Auth ────────────────────────────────────
export const api = {
  auth: {
    getRedirectUrl: () => apiFetch<{ url: string }>("/auth/redirect-url"),
    login: (requestToken: string, redirectUri: string) =>
      apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({ requestToken, redirectUri }),
      }),
    me: () => apiFetch<{ clientCode: string; name: string }>("/auth/me"),
    logout: () => apiFetch("/auth/logout", { method: "POST" }),
  },

  // ─── Positions ───────────────────────────────
  positions: {
    list: () => apiFetch<{ positions: any[] }>("/positions"),
    enableAutoExit: (id: string, config: any) =>
      apiFetch(`/positions/${id}/auto-exit`, {
        method: "POST",
        body: JSON.stringify(config),
      }),
  },

  // ─── Market Data ─────────────────────────────
  market: {
    optionsChain: (symbol: string, expiry: string) =>
      apiFetch(`/market/options-chain?symbol=${symbol}&expiry=${expiry}`),
    indicators: () => apiFetch("/market/indicators"),
    ohlc: (symbol: string, interval: string, days: number) =>
      apiFetch(`/market/ohlc?symbol=${symbol}&interval=${interval}&days=${days}`),
  },

  // ─── Strategy ────────────────────────────────
  strategy: {
    suggest: (params: any) =>
      apiFetch("/strategy/suggest", {
        method: "POST",
        body: JSON.stringify(params),
      }),
    autoScan: (capital: number = 200000) =>
      apiFetch(`/strategy/auto-scan?capital=${capital}`),
  },

  // ─── Live execution (5paisa) — use with care ─
  trading: {
    executeScan: (
      legs: Array<{
        action: "BUY" | "SELL";
        scripCode?: number;
        premium: number;
        strike?: number;
        optionType?: "CE" | "PE";
      }>,
      quantity?: number,
      strategy?: {
        scanTradeId?: string;
        tradeType?: string;
        direction?: string;
        edge?: string;
        rationale?: string[];
      } | null,
    ) =>
      apiFetch<{
        results: Array<{
          scripCode: number;
          ok: boolean;
          orderId?: string;
          error?: string;
        }>;
        quantity: number;
        allOk: boolean;
        journalOpenId?: string | null;
      }>("/trading/execute-scan", {
        method: "POST",
        body: JSON.stringify({ legs, quantity, strategy }),
      }),
  },

  journal: {
    list: (limit?: number) =>
      apiFetch<{
        mongoConfigured?: boolean;
        message?: string;
        records: any[];
      }>(`/journal${limit ? `?limit=${limit}` : ""}`),
    pnl: (period: "week" | "month" | "year") =>
      apiFetch<{
        mongoConfigured?: boolean;
        period: string;
        buckets: Array<{
          bucket: string;
          label: string;
          tradeCount: number;
          totalPnlRupees: number;
          avgPnlRupees: number;
          wins: number;
          losses: number;
        }>;
      }>(`/journal/pnl?period=${period}`),
  },

  // ─── Backtest ────────────────────────────────
  backtest: {
    run: (params: any) =>
      apiFetch("/backtest/run", {
        method: "POST",
        body: JSON.stringify(params),
      }),
  },

  // ─── Logs ────────────────────────────────────
  logs: {
    postEvent: (type: string, data: any) =>
      apiFetch("/logs/event", {
        method: "POST",
        body: JSON.stringify({ type, data }),
      }),
  },
};
