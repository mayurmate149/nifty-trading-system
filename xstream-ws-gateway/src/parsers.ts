import type { Raw5paisaRow } from "./types.js";

const TOKEN_NIFTY = 999920000;
const TOKEN_BANKNIFTY = 999920005;
const TOKEN_VIX = 999920019;

export function symbolForToken(token: number): "NIFTY" | "BANKNIFTY" | "VIX" | undefined {
  if (token === TOKEN_NIFTY) return "NIFTY";
  if (token === TOKEN_BANKNIFTY) return "BANKNIFTY";
  if (token === TOKEN_VIX) return "VIX";
  return undefined;
}

/** Normalize WebSocket text payloads into per-row objects. */
export function parse5paisaPayload(raw: string): Raw5paisaRow[] {
  const t = raw.trim();
  if (!t) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(t) as unknown;
  } catch {
    return [];
  }
  if (Array.isArray(parsed)) {
    return (parsed as Raw5paisaRow[]).filter((x) => x && typeof x === "object");
  }
  if (parsed && typeof parsed === "object") {
    return [parsed as Raw5paisaRow];
  }
  return [];
}

export function toGatewayTick(row: Raw5paisaRow) {
  const token = Number(row.Token ?? NaN);
  if (!Number.isFinite(token)) return null;
  return {
    type: "tick" as const,
    token,
    symbol: symbolForToken(token),
    exch: row.Exch,
    exchType: row.ExchType,
    lastRate: Number(row.LastRate ?? 0),
    pClose: Number(row.PClose ?? 0),
    lastQty: Number(row.LastQty ?? 0),
    totalQty: Number(row.TotalQty ?? 0),
    high: Number(row.High ?? 0),
    low: Number(row.Low ?? 0),
    openRate: Number(row.OpenRate ?? 0),
    avgRate: Number(row.AvgRate ?? 0),
    time: row.Time,
    serverTs: Date.now(),
  };
}

export const DEFAULT_SUBSCRIPTIONS: { Exch: string; ExchType: string; ScripCode: number }[] = [
  { Exch: "N", ExchType: "C", ScripCode: TOKEN_NIFTY },
  { Exch: "N", ExchType: "C", ScripCode: TOKEN_BANKNIFTY },
  { Exch: "N", ExchType: "C", ScripCode: TOKEN_VIX },
];
