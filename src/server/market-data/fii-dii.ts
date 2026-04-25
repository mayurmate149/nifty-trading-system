/**
 * FII / DII cash + derivative net figures from NSE public API (session cookie required).
 * Falls back to unavailable when the feed cannot be read (not a data vendor).
 */

export interface FiiDiiRow {
  category: string;
  buyValue: number;
  sellValue: number;
  netValue: number;
}

export interface FiiDiiSnapshot {
  asOf: string;
  rows: FiiDiiRow[];
  dataAvailable: true;
  source: "nseindia.com";
  /** True if NSE failed this time but a recent successful copy was reused */
  servedFromCache?: boolean;
  cacheNote?: string;
}

export interface FiiDiiUnavailable {
  dataAvailable: false;
  message: string;
}

function parseNseNum(s: string | number | undefined): number {
  if (typeof s === "number" && !Number.isNaN(s)) return s;
  if (typeof s === "string") {
    const n = Number(s.replace(/,/g, "").trim());
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

/** Reuse a good response to avoid hammering NSE; still refresh at least every TTL. */
const CACHE_TTL_MS = 5 * 60 * 1000;
/** After NSE error, return stale data if younger than this */
const STALE_MAX_MS = 4 * 60 * 60 * 1000;

let memoryCache: { t: number; data: FiiDiiSnapshot } | null = null;

function asOfFromRows(rows: FiiDiiRow[]): string {
  for (const r of rows) {
    const m = r.category.match(/\d{1,2}-[A-Za-z]{3}-\d{4}/);
    if (m) return m[0];
  }
  return new Date().toISOString().slice(0, 10);
}

function staleFallback(reason: string): FiiDiiSnapshot | FiiDiiUnavailable {
  if (memoryCache && Date.now() - memoryCache.t < STALE_MAX_MS) {
    return {
      ...memoryCache.data,
      servedFromCache: true,
      cacheNote: `NSE request failed (${reason}). Showing last successful snapshot.`,
    };
  }
  return { dataAvailable: false, message: reason };
}

/**
 * Fetches the latest FII/DII + MF table from NSE. Returns null rows on hard failure.
 */
export async function fetchFiiDiiNseTable(): Promise<FiiDiiSnapshot | FiiDiiUnavailable> {
  if (memoryCache && Date.now() - memoryCache.t < CACHE_TTL_MS) {
    return { ...memoryCache.data, servedFromCache: true, cacheNote: "Served from in-memory cache (5 min)." };
  }

  const base = "https://www.nseindia.com";
  const path = "https://www.nseindia.com/api/fiidiiMfNew";
  const userAgent =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  let cookie: string = "";
  try {
    const warm = await fetch(base, {
      headers: {
        "User-Agent": userAgent,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-IN,en;q=0.9",
      },
    });
    const set = typeof warm.headers.getSetCookie === "function" ? warm.headers.getSetCookie() : [];
    if (set.length) {
      cookie = set.map((c) => c.split(";")[0]).join("; ");
    } else {
      const c = warm.headers.get("set-cookie");
      if (c) cookie = c.split(",")[0]?.split(";")[0] ?? "";
    }
  } catch {
    // continue without warm cookie; may still 403
  }

  try {
    const res = await fetch(path, {
      headers: {
        "User-Agent": userAgent,
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-IN,en;q=0.9",
        Referer: base + "/all-reports-derivatives_fii_dii_cash-and-fo",
        "X-Requested-With": "XMLHttpRequest",
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
    if (!res.ok) {
      return staleFallback(`HTTP ${res.status}`);
    }
    const json: unknown = await res.json();
    const asArray: Record<string, unknown>[] = Array.isArray(json)
      ? (json as Record<string, unknown>[])
      : (json as { data?: unknown })?.data != null && Array.isArray((json as { data: unknown }).data)
        ? ((json as { data: Record<string, unknown>[] }).data)
        : [];

    if (asArray.length === 0) {
      return staleFallback("empty or unknown JSON shape");
    }
    const rows: FiiDiiRow[] = [];
    for (const rec of asArray) {
      const buy =
        rec["fiifiiGrossValueBuy"] ??
        rec["fiiFiiGrossValueBuy"] ??
        rec["buyValue"] ??
        rec["buy"];
      const sell =
        rec["fiifiiGrossValueSell"] ??
        rec["fiiFiiGrossValueSell"] ??
        rec["sellValue"] ??
        rec["sell"];
      const net = rec["fiifiiGrossValueNet"] ?? rec["fiiFiiGrossValueNet"] ?? rec["netValue"] ?? rec["net"];
      const cat = String(rec["category"] ?? rec["fiiDiiMfName"] ?? rec["dealing"] ?? "—");
      const bv = parseNseNum(buy as any);
      const sv = parseNseNum(sell as any);
      const nv = parseNseNum(net as any) || (bv - sv);
      rows.push({
        category: cat,
        buyValue: bv,
        sellValue: sv,
        netValue: nv,
      });
    }
    if (rows.length === 0) {
      return staleFallback("no parseable rows");
    }
    const asOf = asOfFromRows(rows);
    const snap: FiiDiiSnapshot = {
      dataAvailable: true,
      asOf,
      rows: rows.slice(0, 12),
      source: "nseindia.com",
    };
    memoryCache = { t: Date.now(), data: snap };
    return snap;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    return staleFallback(msg);
  }
}
