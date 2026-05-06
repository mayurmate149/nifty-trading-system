"use client";

/**
 * Trader calendar — macro risk + exchange closures for professional planning.
 * Data: NSE holidays (embedded) + Finnhub economic calendar via free API key (FINNHUB_API_KEY).
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  parseIstMonthFromYyyymm,
  getIstMonthBounds,
  getIstTodayIsoDate,
  getIstMonthGridCells,
} from "@/lib/trader-calendar-utils";

type Impact = "high" | "medium" | "low" | "holiday";

interface CalEvent {
  id: string;
  date: string;
  timeIst: string | null;
  region: string;
  title: string;
  impact: Impact;
  kind: string;
  forecast: string | null;
  previous: string | null;
  actual: string | null;
  source: string;
}

interface CalPayload {
  generatedAt: string;
  from: string;
  to: string;
  events: CalEvent[];
  sources: string[];
  notice?: string;
  finnhubMeta?: { rawRowCount: number; keptRowCount: number };
}

const DOT_CLASS: Record<Impact, string> = {
  holiday: "bg-violet-400",
  high: "bg-rose-400",
  medium: "bg-amber-400",
  low: "bg-slate-500",
};

const WEEKDAYS_SUN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function impactDotsForDay(events: CalEvent[]): Impact[] {
  const seen = new Set<Impact>();
  for (const e of events) seen.add(e.impact);
  const order: Impact[] = ["holiday", "high", "medium", "low"];
  return order.filter((x) => seen.has(x));
}

const IMPACT_RING: Record<Impact, string> = {
  high: "border-rose-500/50 bg-rose-500/10 text-rose-200",
  medium: "border-amber-500/40 bg-amber-500/10 text-amber-200",
  low: "border-slate-600 bg-slate-800/80 text-slate-400",
  holiday: "border-violet-500/40 bg-violet-500/10 text-violet-200",
};

function istYyyymmFromToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${y}-${m}`;
}

function shiftMonth(yyyymm: string, delta: number): string {
  const p = parseIstMonthFromYyyymm(yyyymm);
  if (!p) return yyyymm;
  let { year, month } = p;
  month += delta;
  while (month < 1) {
    month += 12;
    year -= 1;
  }
  while (month > 12) {
    month -= 12;
    year += 1;
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

export default function TraderCalendarPage() {
  const [month, setMonth] = useState(istYyyymmFromToday);
  const [highOnly, setHighOnly] = useState(true);
  const [selectedIso, setSelectedIso] = useState<string | null>(null);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["trader-calendar", month],
    queryFn: () => api.market.traderCalendar({ month }) as Promise<CalPayload>,
  });

  const filtered = useMemo(() => {
    if (!data?.events) return [];
    if (!highOnly) return data.events;
    return data.events.filter((e) => e.impact === "high" || e.impact === "holiday");
  }, [data?.events, highOnly]);

  const eventsByIso = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of filtered) {
      const list = m.get(e.date) ?? [];
      list.push(e);
      m.set(e.date, list);
    }
    return m;
  }, [filtered]);

  const monthParsed = useMemo(() => parseIstMonthFromYyyymm(month), [month]);

  const gridCells = useMemo(() => {
    if (!monthParsed) return [];
    return getIstMonthGridCells(monthParsed.year, monthParsed.month);
  }, [monthParsed]);

  /** Default selection when month loads: IST today if in month, else first of month. */
  useEffect(() => {
    if (isLoading) return;
    const p = parseIstMonthFromYyyymm(month);
    if (!p) return;
    const { from, to } = getIstMonthBounds(p.year, p.month);
    const today = getIstTodayIsoDate();
    setSelectedIso(today >= from && today <= to ? today : from);
  }, [month, isLoading]);

  const monthLabel = useMemo(() => {
    const p = parseIstMonthFromYyyymm(month);
    if (!p) return month;
    return new Date(p.year, p.month - 1, 1).toLocaleString("en-IN", {
      month: "long",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    });
  }, [month]);

  const bounds = useMemo(() => {
    const p = parseIstMonthFromYyyymm(month);
    if (!p) return { from: "", to: "" };
    return getIstMonthBounds(p.year, p.month);
  }, [month]);

  const istTodayIso = getIstTodayIsoDate();

  const jumpToToday = () => {
    setMonth(istYyyymmFromToday());
    setSelectedIso(getIstTodayIsoDate());
  };

  const selectedEvents = selectedIso ? (eventsByIso.get(selectedIso) ?? []) : [];

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 pb-20 pt-8 sm:px-6">
      <header className="mb-8 flex flex-col gap-4 border-b border-slate-800 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
            Risk &amp; session planning
          </p>
          <p className="mt-2 max-w-xl text-sm text-slate-400">
            High-impact macro releases (US / India / major regions when configured) and{" "}
            <span className="text-violet-300">NSE cash &amp; F&amp;O closures</span>. Times shown in
            IST where available; verify release tables against your data vendor.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/pro-trader"
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 hover:border-slate-500"
          >
            ← Pro Trader
          </Link>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            {isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-900/50 p-1">
          <button
            type="button"
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
            className="rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
            aria-label="Previous month"
          >
            ‹
          </button>
          <span className="min-w-[10rem] px-3 text-center text-sm font-semibold capitalize text-white">
            {monthLabel}
          </span>
          <button
            type="button"
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
            className="rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
            aria-label="Next month"
          >
            ›
          </button>
          <button
            type="button"
            onClick={jumpToToday}
            className="ml-1 rounded-lg border border-violet-600/50 bg-violet-950/40 px-2 py-1.5 text-[11px] font-medium text-violet-200 hover:border-violet-500 hover:bg-violet-950/70"
          >
            Today
          </button>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={highOnly}
            onChange={(e) => setHighOnly(e.target.checked)}
            className="rounded border-slate-600"
          />
          High + holidays only
        </label>
      </div>

      {data?.notice && (
        <div className="mb-6 rounded-xl border border-amber-800/50 bg-amber-950/25 px-4 py-3 text-sm text-amber-100/90">
          <p>{data.notice}</p>
          {data.finnhubMeta ? (
            <p className="mt-2 font-mono text-[11px] text-amber-200/70">
              Finnhub: {data.finnhubMeta.rawRowCount} row(s) in response → {data.finnhubMeta.keptRowCount}{" "}
              shown after filters
            </p>
          ) : null}
        </div>
      )}

      {error && (
        <div className="mb-6 rounded-xl border border-rose-900 bg-rose-950/30 p-4 text-sm text-rose-200">
          {(error as Error).message}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2 text-[11px] text-slate-500">
        <span>
          Range:{" "}
          <span className="font-mono text-slate-400">
            {bounds.from} → {bounds.to}
          </span>
        </span>
        {data?.sources?.length ? (
          <span className="text-slate-600">· Sources: {data.sources.join(", ")}</span>
        ) : null}
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-3 sm:p-4">
          <div className="mb-4 h-4 w-48 animate-pulse rounded bg-slate-800" />
          <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
            {Array.from({ length: 35 }).map((_, i) => (
              <div
                key={i}
                className="min-h-[3.75rem] animate-pulse rounded-xl bg-slate-900/80 sm:min-h-[4.75rem]"
              />
            ))}
          </div>
        </div>
      ) : (
        <>
          {monthParsed ? (
            <section
              className="mb-10 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900/90 to-slate-950/90 p-3 shadow-xl shadow-black/30 sm:p-5"
              aria-label="Month calendar IST"
            >
              <div className="mb-4 flex flex-col gap-1 border-b border-slate-800/80 pb-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-white">Calendar</h2>
                  <p className="text-[11px] text-slate-500">
                    Sundays first · IST · Click a date to see releases below
                  </p>
                </div>
              </div>

              {filtered.length === 0 ? (
                <p className="mb-4 rounded-lg border border-slate-700/80 bg-slate-900/30 px-3 py-2 text-xs text-slate-500">
                  No events match the current filters for this month. Try turning off &quot;High +
                  holidays only&quot; or change month.
                </p>
              ) : null}

              <div className="grid grid-cols-7 gap-1 sm:gap-2">
                {WEEKDAYS_SUN.map((w) => (
                  <div
                    key={w}
                    className="pb-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500 sm:text-xs"
                  >
                    {w}
                  </div>
                ))}
                {gridCells.map((cell, idx) =>
                  cell ? (
                    <button
                      key={cell.iso}
                      type="button"
                      onClick={() => setSelectedIso(cell.iso)}
                      className={`relative flex min-h-[3.75rem] flex-col rounded-xl border p-1.5 text-left transition-colors sm:min-h-[4.75rem] sm:p-2 ${
                        cell.iso === selectedIso
                          ? "border-cyan-500/70 bg-cyan-950/25 ring-2 ring-cyan-500/40"
                          : cell.iso === istTodayIso
                            ? "border-violet-500/60 bg-violet-950/30 ring-1 ring-violet-500/40"
                            : "border-slate-700/80 bg-slate-900/40 hover:border-slate-600 hover:bg-slate-800/60"
                      }`}
                      aria-pressed={cell.iso === selectedIso}
                      aria-label={`${cell.iso}, ${
                        (eventsByIso.get(cell.iso) ?? []).length
                      } event(s) in current filter`}
                    >
                      <span
                        className={`text-sm font-semibold tabular-nums sm:text-base ${
                          cell.iso === istTodayIso ? "text-violet-200" : "text-slate-100"
                        }`}
                      >
                        {cell.dayOfMonth}
                      </span>
                      <div className="mt-auto flex min-h-[14px] flex-wrap items-end gap-0.5">
                        <div className="flex flex-wrap gap-0.5">
                          {impactDotsForDay(eventsByIso.get(cell.iso) ?? []).map((imp) => (
                            <span
                              key={imp}
                              title={imp}
                              className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASS[imp]}`}
                            />
                          ))}
                        </div>
                        {(eventsByIso.get(cell.iso) ?? []).length > 0 ? (
                          <span className="ml-auto font-mono text-[9px] tabular-nums text-slate-500 sm:text-[10px]">
                            {(eventsByIso.get(cell.iso) ?? []).length}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  ) : (
                    <div
                      key={`pad-${idx}`}
                      className="min-h-[3.75rem] rounded-xl border border-transparent bg-slate-950/10 sm:min-h-[4.75rem]"
                      aria-hidden
                    />
                  ),
                )}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-800 pt-3 text-[10px] text-slate-500">
                <span className="font-semibold text-slate-400">Dots</span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-violet-400" /> Holiday
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-400" /> High
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Medium
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-500" /> Low
                </span>
                <span className="inline-flex items-center gap-1 text-slate-600">
                  Cyan ring = selected day
                </span>
              </div>

              {selectedIso ? (
                <div className="mt-6 border-t border-slate-800 pt-5">
                  <h3 className="mb-3 flex flex-wrap items-baseline gap-2 border-b border-slate-800/80 pb-2 text-sm font-semibold text-slate-200">
                    <span className="font-mono text-violet-300">{selectedIso}</span>
                    {selectedIso === istTodayIso ? (
                      <span className="rounded bg-violet-600/30 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-200">
                        Today (IST)
                      </span>
                    ) : null}
                    <span className="font-normal text-slate-500">
                      {new Date(`${selectedIso}T12:00:00`).toLocaleDateString("en-IN", {
                        weekday: "long",
                        timeZone: "Asia/Kolkata",
                      })}
                    </span>
                  </h3>
                  {selectedEvents.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-700 bg-slate-900/20 px-4 py-8 text-center text-sm text-slate-500">
                      No events on this IST date with the current filters.
                      {highOnly ? (
                        <span className="mt-2 block text-xs text-slate-600">
                          Turn off &quot;High + holidays only&quot; to see more releases.
                        </span>
                      ) : null}
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {selectedEvents.map((ev) => (
                        <li
                          key={ev.id}
                          className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3 sm:flex sm:items-start sm:gap-4"
                        >
                          <div className="mb-2 flex flex-shrink-0 flex-wrap items-center gap-2 sm:mb-0 sm:w-44 sm:flex-col sm:items-start">
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${IMPACT_RING[ev.impact as Impact] ?? IMPACT_RING.medium}`}
                            >
                              {ev.impact}
                            </span>
                            <span className="font-mono text-[11px] text-slate-500">{ev.region}</span>
                            {ev.timeIst ? (
                              <span className="font-mono text-xs text-slate-400">{ev.timeIst} IST</span>
                            ) : null}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-slate-100">{ev.title}</p>
                            {ev.kind === "macro" && (ev.forecast || ev.previous || ev.actual) ? (
                              <p className="mt-1 text-xs text-slate-500">
                                {ev.actual != null ? (
                                  <span className="text-slate-300">Act {ev.actual}</span>
                                ) : null}
                                {ev.forecast != null ? (
                                  <span className="ml-2">Est {ev.forecast}</span>
                                ) : null}
                                {ev.previous != null ? (
                                  <span className="ml-2">Prev {ev.previous}</span>
                                ) : null}
                              </p>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      )}

      <footer className="mt-12 border-t border-slate-800 pt-6 text-[11px] leading-relaxed text-slate-600">
        <p>
          NSE holidays are included for 2026 weekday closures (verify against official NSE
          notices). Macro releases use{" "}
          <a
            href="https://finnhub.io/register"
            className="text-violet-400 hover:text-violet-300"
            target="_blank"
            rel="noreferrer"
          >
            Finnhub
          </a>
          &apos;s free API: sign up, copy your token, and set{" "}
          <span className="font-mono text-slate-400">FINNHUB_API_KEY</span> (paid plan not required
          for typical calendar usage; respect their published rate limits). This module is for
          planning only — not investment advice.
        </p>
      </footer>
    </div>
  );
}
