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
        greeks?: {
          delta?: number;
          gamma?: number;
          theta?: number;
          vega?: number;
          iv?: number;
        };
        oi?: number;
        changeInOi?: number;
        volume?: number;
      }>,
      quantity?: number,
      strategy?: {
        scanTradeId?: string;
        tradeType?: string;
        direction?: string;
        edge?: string;
        rationale?: string[];
        metrics?: {
          netCredit?: number;
          maxProfit?: number;
          maxLoss?: number;
          riskReward?: number;
          marginRequired?: number;
          winProbability?: number;
          expectedValue?: number;
          kellyScore?: number;
          thetaDecayPerDay?: number;
          score?: number;
          breakeven?: number[];
          oiWall?: string;
          targetTime?: string;
          warnings?: string[];
        };
      } | null,
      marketContext?: {
        spot?: number;
        spotChange?: number;
        spotChangePct?: number;
        vix?: number;
        pcr?: number;
        trend?: string;
        trendStrength?: number;
        ivPercentile?: number;
        daysToExpiry?: number;
        expiry?: string;
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
        body: JSON.stringify({ legs, quantity, strategy, marketContext }),
      }),
  },

  journal: {
    list: (limit?: number) =>
      apiFetch<{
        mongoConfigured?: boolean;
        message?: string;
        records: any[];
      }>(`/journal${limit ? `?limit=${limit}` : ""}`),
    remove: (id: string) =>
      apiFetch<{ ok: boolean; id?: string; deleted?: number; message?: string }>(
        `/journal/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      ),
    pnl: (period: "day" | "week" | "month" | "year") =>
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
          winRatePct: number;
          avgWin: number;
          avgLoss: number;
          profitFactor: number | null;
          bestTrade: number;
          worstTrade: number;
          expectancy: number;
          avgHoldingMin: number | null;
        }>;
        overall?: {
          totalPnlRupees: number;
          tradeCount: number;
          wins: number;
          losses: number;
          winRatePct: number;
          avgWin: number;
          avgLoss: number;
          profitFactor: number | null;
          bestTrade: number;
          worstTrade: number;
          expectancy: number;
          avgHoldingMin: number | null;
        };
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
