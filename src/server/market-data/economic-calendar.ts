/**
 * Trader calendar — high-impact macro events (Finnhub) + NSE equity/F&O closures.
 * Finnhub: set FINNHUB_API_KEY for macro events (free tier at finnhub.io).
 */

import type {
  TraderCalendarEvent,
  TraderCalendarPayload,
  CalendarImpactLevel,
} from "./economic-calendar-types";
import { pad2 } from "@/lib/trader-calendar-utils";

export type {
  TraderCalendarEvent,
  TraderCalendarPayload,
  CalendarImpactLevel,
  CalendarEventKind,
} from "./economic-calendar-types";

/**
 * NSE equity / F&amp;O trading holidays 2026 (weekday closures per NSE notification).
 * Weekend-only observances excluded. Verify on https://www.nseindia.com/resources/exchange-communication-holidays
 */
const NSE_WEEKDAY_HOLIDAYS_2026: { date: string; name: string }[] = [
  { date: "2026-01-26", name: "Republic Day" },
  { date: "2026-03-03", name: "Holi" },
  { date: "2026-03-26", name: "Shri Ram Navami" },
  { date: "2026-03-31", name: "Shri Mahavir Jayanti" },
  { date: "2026-04-03", name: "Good Friday" },
  { date: "2026-04-14", name: "Dr. Baba Saheb Ambedkar Jayanti" },
  { date: "2026-05-01", name: "Maharashtra Day" },
  { date: "2026-05-28", name: "Bakri Id (estimated; confirm with NSE)" },
  { date: "2026-06-26", name: "Muharram" },
  { date: "2026-09-14", name: "Ganesh Chaturthi" },
  { date: "2026-10-02", name: "Mahatma Gandhi Jayanti" },
  { date: "2026-10-20", name: "Dussehra" },
  { date: "2026-11-10", name: "Diwali — Balipratipada" },
  { date: "2026-11-24", name: "Prakash Gurpurab — Sri Guru Nanak Dev" },
  { date: "2026-12-25", name: "Christmas" },
];

const MACRO_REGIONS = new Set([
  "US",
  "IN",
  "GB",
  "EU",
  "EZ",
  "DE",
  "FR",
  "JP",
  "CN",
  "CA",
  "AU",
  "CH",
  "KR",
  "IT",
  "ES",
  "NL",
  "SG",
  "HK",
  "NZ",
]);

/** Map Finnhub / alternate API spellings to a 2-letter region code where possible. */
const COUNTRY_CODE_ALIASES: Record<string, string> = {
  USA: "US",
  "UNITED STATES": "US",
  UK: "GB",
  GBR: "GB",
  "UNITED KINGDOM": "GB",
  ENGLAND: "GB",
  IND: "IN",
  INDIA: "IN",
  DEU: "DE",
  GERMANY: "DE",
  FRA: "FR",
  JPN: "JP",
  CHN: "CN",
  CAN: "CA",
  AUS: "AU",
  CHE: "CH",
  KOR: "KR",
  ITA: "IT",
  ESP: "ES",
  NLD: "NL",
  SGP: "SG",
  HKG: "HK",
  NZL: "NZ",
  /** Euro area / ECB-style releases often tagged as EMU/EUR on data feeds */
  EMU: "EU",
  EUR: "EU",
};

function normalizeCountry(raw: unknown): string {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
  if (!s) return "ZZ";
  const aliased = COUNTRY_CODE_ALIASES[s];
  if (aliased) return aliased;
  if (/^[A-Z]{2}$/.test(s)) return s;
  return "ZZ";
}

function inDateRange(d: string, from: string, to: string): boolean {
  return d >= from && d <= to;
}

function nseHolidaysInRange(from: string, to: string): TraderCalendarEvent[] {
  return NSE_WEEKDAY_HOLIDAYS_2026.filter((h) => inDateRange(h.date, from, to)).map((h, i) => ({
    id: `nse-${h.date}-${i}`,
    date: h.date,
    timeIst: null,
    region: "IN",
    title: `NSE / BSE closed — ${h.name}`,
    impact: "holiday",
    kind: "market_holiday",
    forecast: null,
    previous: null,
    actual: null,
    source: "nse",
  }));
}

function normalizeImpact(raw: string | undefined): CalendarImpactLevel {
  const x = (raw ?? "").toLowerCase().trim();
  if (x === "high" || x === "3" || x === "h") return "high";
  if (x === "medium" || x === "2" || x === "m") return "medium";
  if (x === "low" || x === "1" || x === "l") return "low";
  return "medium";
}

function fmtNum(n: unknown): string | null {
  if (n == null || n === "") return null;
  return String(n);
}

/** Parse common Finnhub date encodings (ISO string, YYYYMMDD int/str, unix sec/ms). */
function coalesceFinnhubDay(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    const t = value.trim();
    // Many Finnhub tiers put the calendar day only in `time` as "2026-05-01 00:00:00" (no `date` field).
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
    if (/^\d{8}$/.test(t)) {
      return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
    }
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const int = Math.trunc(value);
    const as8 = String(int);
    // YYYYMMDD (e.g. 20260506) — Finnhub has used this shape on some tiers
    if (/^\d{8}$/.test(as8) && int >= 19700101 && int <= 21001231) {
      return `${as8.slice(0, 4)}-${as8.slice(4, 6)}-${as8.slice(6, 8)}`;
    }
    // Unix seconds or ms → UTC calendar day (macro dates are exchange-local elsewhere)
    const abs = Math.abs(int);
    if (abs >= 1e9 && abs < 1e15) {
      const ms = abs < 1e12 ? int * 1000 : int;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToFinnhubDate(row: any): string | null {
  const candidates = [
    row.date,
    row.Date,
    row.releaseDate,
    row.ReleaseDate,
    row.eventDate,
    row.EventDate,
    /** Finnhub often omits `date` and encodes the day in `time` (datetime or ISO). */
    row.time,
    row.Time,
  ];
  for (const c of candidates) {
    const day = coalesceFinnhubDay(c);
    if (day) return day;
  }
  const y = row.year ?? row.Year;
  const mo = row.month ?? row.Month;
  const d = row.day ?? row.Day;
  if (y != null && mo != null && d != null) {
    const monthNum =
      typeof mo === "string"
        ? new Date(`${mo} 1, ${y}`).getMonth() + 1
        : Number(mo);
    const dayNum = Number(d);
    const yearNum = Number(y);
    if (Number.isFinite(monthNum) && Number.isFinite(dayNum) && Number.isFinite(yearNum)) {
      return `${yearNum}-${pad2(monthNum)}-${pad2(dayNum)}`;
    }
  }
  return null;
}

function extractFinnhubRows(data: unknown): unknown[] {
  if (!data || typeof data !== "object") return [];
  const o = data as Record<string, unknown>;
  if (Array.isArray(o.economicCalendar)) return o.economicCalendar;
  if (Array.isArray(o.data)) return o.data;
  if (Array.isArray(o.events)) return o.events;
  const inner = o.result;
  if (inner && typeof inner === "object") {
    const ir = inner as Record<string, unknown>;
    if (Array.isArray(ir.economicCalendar)) return ir.economicCalendar;
  }
  return [];
}

/**
 * Finnhub `time` is often HHMM in exchange local; display as given + note, or convert if full ISO.
 */
function parseTimeToIstLabel(row: Record<string, unknown>): string | null {
  const t = row.time ?? row.Time;
  if (t == null || t === "") return null;
  // Finnhub often sends full datetimes in `time` (also used for calendar day).
  if (typeof t === "string" && /^\d{4}-\d{2}-\d{2}(T|[\s])\d/.test(t)) {
    try {
      const normalized = /^\d{4}-\d{2}-\d{2} /.test(t) ? t.replace(" ", "T") : t;
      const d = new Date(normalized);
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleTimeString("en-IN", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
      }
    } catch {
      /* fall through */
    }
  }
  if (typeof t === "string" && /^\d{4}-\d{2}-\d{2}T/.test(t)) {
    try {
      const d = new Date(t);
      return d.toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    } catch {
      return t;
    }
  }
  if (typeof t === "string" && /^\d{3,4}$/.test(t.replace(":", ""))) {
    const raw = t.replace(":", "");
    const h = raw.length === 3 ? raw.slice(0, 1) : raw.slice(0, 2);
    const m = raw.length === 3 ? raw.slice(1) : raw.slice(2);
    return `${h.padStart(2, "0")}:${m} (source local — verify)`;
  }
  return String(t);
}

type FinnhubEconomicFetchResult = {
  events: TraderCalendarEvent[];
  rawRowCount: number;
  keptRowCount: number;
  httpOk: boolean;
};

async function fetchFinnhubEconomic(
  from: string,
  to: string,
  token: string,
): Promise<FinnhubEconomicFetchResult> {
  const url = `https://finnhub.io/api/v1/calendar/economic?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&token=${encodeURIComponent(token)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12_000);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) {
      return { events: [], rawRowCount: 0, keptRowCount: 0, httpOk: false };
    }
    const data: unknown = await res.json();
    const rows = extractFinnhubRows(data);
    const rawRowCount = rows.length;

    const out: TraderCalendarEvent[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as Record<string, unknown>;
      const date = rowToFinnhubDate(row);
      if (!date || !inDateRange(date, from, to)) continue;
      const country = normalizeCountry(
        row.country ?? row.Country ?? row.iso ?? row.ISO ?? row.region ?? row.Region,
      );
      const impactRaw = row.impact ?? row.Impact;
      const impact = normalizeImpact(
        impactRaw != null && impactRaw !== "" ? String(impactRaw) : undefined,
      );
      if (impact === "low" && !MACRO_REGIONS.has(country)) continue;
      const title = String(row.event ?? row.Event ?? "Economic release");
      const id = `fh-${date}-${country}-${i}-${title.slice(0, 24).replace(/\W/g, "")}`;

      out.push({
        id,
        date,
        timeIst: parseTimeToIstLabel(row),
        region: country,
        title,
        impact,
        kind: "macro",
        forecast: fmtNum(row.estimate ?? row.Estimate ?? row.forecast ?? row.Forecast),
        previous: fmtNum(row.prev ?? row.Prev ?? row.previous ?? row.Previous),
        actual: fmtNum(row.actual ?? row.Actual),
        source: "finnhub",
      });
    }
    return { events: out, rawRowCount, keptRowCount: out.length, httpOk: true };
  } finally {
    clearTimeout(timer);
  }
}

export async function getTraderCalendar(
  from: string,
  to: string,
  opts?: { finnhubToken?: string },
): Promise<TraderCalendarPayload> {
  const sources: string[] = [];
  const notices: string[] = [];
  const holidays = nseHolidaysInRange(from, to);
  sources.push("nse");

  let macro: TraderCalendarEvent[] = [];
  let finnhubMeta: TraderCalendarPayload["finnhubMeta"];
  const token = opts?.finnhubToken?.trim() || process.env.FINNHUB_API_KEY?.trim();
  if (token) {
    try {
      const finn = await fetchFinnhubEconomic(from, to, token);
      finnhubMeta = { rawRowCount: finn.rawRowCount, keptRowCount: finn.keptRowCount };
      macro = finn.events;
      if (!finn.httpOk) {
        notices.push("Finnhub returned an error for this request — showing NSE holidays only.");
      } else if (macro.length) {
        sources.push("finnhub");
      } else if (finn.rawRowCount === 0) {
        notices.push(
          "Finnhub returned no economic calendar rows for this date range. Some tiers omit far-future data — try a nearer month.",
        );
      } else {
        notices.push(
          `Finnhub returned ${finn.rawRowCount} calendar row(s) in range but none matched display filters (e.g. low-impact events outside major economies).`,
        );
      }
    } catch {
      notices.push("Finnhub request failed — showing NSE holidays only.");
    }
  } else {
    notices.push(
      "Macro releases: add a free Finnhub API token — set FINNHUB_API_KEY (sign up at finnhub.io). US Fed, CPI, payrolls, RBI, etc.",
    );
  }

  const merged = [...holidays, ...macro].sort((a, b) => {
    const da = a.date.localeCompare(b.date);
    if (da !== 0) return da;
    const ta = a.timeIst ?? "";
    const tb = b.timeIst ?? "";
    return ta.localeCompare(tb);
  });

  return {
    generatedAt: new Date().toISOString(),
    from,
    to,
    events: merged,
    sources,
    notice: notices.length ? notices.join(" ") : undefined,
    ...(finnhubMeta ? { finnhubMeta } : {}),
  };
}
