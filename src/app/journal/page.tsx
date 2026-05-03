"use client";

/**
 * Professional trade journal — automatic entries from Pro Desk executions
 * and portfolio exits (manual / trailing auto-exit). P&L is broker MTOM (₹) at exit snapshot.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

type TabKey = "activity" | "pnl";

function formatInr(n: number) {
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(Math.round(n * 100) / 100);
  return `${sign}₹${v.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function istDateTime(iso: string | Date | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function JournalPage() {
  const [tab, setTab] = useState<TabKey>("activity");
  const [pnlPeriod, setPnlPeriod] = useState<"week" | "month" | "year">("month");

  const journalQ = useQuery({
    queryKey: ["journal", 120],
    queryFn: () => api.journal.list(120),
    refetchInterval: 60_000,
  });

  const pnlQ = useQuery({
    queryKey: ["journal-pnl", pnlPeriod],
    queryFn: () => api.journal.pnl(pnlPeriod),
    enabled: tab === "pnl",
    refetchInterval: 60_000,
  });

  const records = journalQ.data?.records ?? [];
  const mongoConfigured = journalQ.data?.mongoConfigured ?? false;

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">📓 Trading journal</h1>
          <p className="mt-1 text-sm text-gray-500">
            Automatic log of executions from Pro Desk and flat exits (manual or auto-exit trail). Review
            structure, fills, and P&amp;L to refine discipline.
          </p>
        </div>
      </div>

      {!journalQ.isLoading && !mongoConfigured ? (
        <div className="mb-6 rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
          MongoDB is not configured. Add{" "}
          <code className="rounded bg-gray-950 px-1.5 py-0.5 text-amber-200">MONGODB_URI</code> and
          optionally <code className="rounded bg-gray-950 px-1.5 py-0.5 text-amber-200">MONGODB_DB_NAME</code>{" "}
          (see your <span className="font-mono">.env</span>) to persist and view the journal here.
        </div>
      ) : null}

      <div className="mb-4 flex gap-2 border-b border-gray-800 pb-px">
        {(
          [
            ["activity", "Activity log"],
            ["pnl", "Profit & loss"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium transition ${
              tab === key
                ? "bg-gray-900 text-emerald-300 ring-1 ring-gray-700"
                : "text-gray-500 hover:bg-gray-900/80 hover:text-gray-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "activity" ? (
        <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900/40 shadow-lg shadow-black/20">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] border-collapse text-left text-sm">
              <thead className="border-b border-gray-700 bg-gray-950/90 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                <tr>
                  <th className="px-4 py-3">When (IST)</th>
                  <th className="px-4 py-3">Kind</th>
                  <th className="px-4 py-3">Context / legs</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">P&amp;L (₹ MTOM)</th>
                  <th className="px-4 py-3 text-right">P&amp;L %</th>
                  <th className="px-4 py-3">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/80">
                {journalQ.isLoading ? (
                  <tr>
                    <td className="px-4 py-8 text-gray-500" colSpan={7}>
                      Loading journal…
                    </td>
                  </tr>
                ) : records.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-gray-500" colSpan={7}>
                      No journal rows yet. Execute from Pro Desk or close the book via auto-exit / exit all.
                    </td>
                  </tr>
                ) : (
                  records.map((row: Record<string, unknown>) => {
                    const id = String(row.id ?? "");
                    const rt = row.recordType as string;
                    if (rt === "OPEN_ENTRY") {
                      const legs = (row.entryLegs as Array<Record<string, unknown>>) ?? [];
                      const strat = row.strategy as Record<string, unknown> | null;
                      const lifecycle = row.lifecycle as string;
                      const legTxt = legs
                        .map(
                          (l) =>
                            `${l.action} ${l.scripCode} ${l.ok ? "✓" : "✗"}`,
                        )
                        .join(" · ");
                      return (
                        <tr key={id} className="hover:bg-gray-800/30">
                          <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-300">
                            {istDateTime(row.openedAt as string)}
                          </td>
                          <td className="px-4 py-3 text-violet-300">Entry</td>
                          <td className="max-w-md px-4 py-3 text-xs text-gray-300">
                            <div className="font-medium text-gray-200">
                              {strat?.tradeType ? String(strat.tradeType) : "Execute-scan"}
                              {strat?.direction ? (
                                <span className="ml-2 text-gray-500">· {String(strat.direction)}</span>
                              ) : null}
                            </div>
                            <div className="mt-1 font-mono text-[11px] text-gray-500">{legTxt}</div>
                            {strat?.edge ? (
                              <div className="mt-1 line-clamp-2 text-[11px] text-gray-600">
                                {String(strat.edge)}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-4 py-3 text-xs">
                            <span
                              className={
                                lifecycle === "OPEN"
                                  ? "text-amber-400"
                                  : "text-gray-500 line-through decoration-gray-600"
                              }
                            >
                              {lifecycle}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-gray-600">—</td>
                          <td className="px-4 py-3 text-right text-gray-600">—</td>
                          <td className="px-4 py-3 text-[11px] text-gray-500">
                            {row.allEntryOrdersOk ? "All legs placed" : "Some legs failed — see leg flags"}
                            {row.supersedeNote ? (
                              <div className="mt-1 text-gray-600">{String(row.supersedeNote)}</div>
                            ) : null}
                          </td>
                        </tr>
                      );
                    }
                    if (rt === "PORTFOLIO_EXIT") {
                      const pnl = Number(row.pnlRupees ?? 0);
                      const pct = Number(row.portfolioPnlPct ?? 0);
                      const reason = String(row.exitReason ?? "");
                      const src = String(row.source ?? "");
                      const ok = Number(row.exitSuccessCount ?? 0);
                      const fail = Number(row.exitFailCount ?? 0);
                      return (
                        <tr key={id} className="hover:bg-gray-800/30">
                          <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-300">
                            {istDateTime(row.closedAt as string)}
                          </td>
                          <td className="px-4 py-3 text-emerald-300">Exit</td>
                          <td className="px-4 py-3 text-xs text-gray-300">
                            <span className="font-medium capitalize text-gray-200">
                              {src.replace(/-/g, " ")}
                            </span>
                            <div className="mt-0.5 text-[11px] text-gray-500">
                              {Number(row.legCount ?? 0)} leg(s) · orders {ok} ok / {fail} failed
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs capitalize text-gray-400">{reason.replace(/_/g, " ")}</td>
                          <td
                            className={`px-4 py-3 text-right font-mono font-semibold ${
                              pnl >= 0 ? "text-emerald-400" : "text-rose-400"
                            }`}
                          >
                            {formatInr(pnl)}
                          </td>
                          <td
                            className={`px-4 py-3 text-right font-mono text-xs ${
                              pct >= 0 ? "text-emerald-400/90" : "text-rose-400/90"
                            }`}
                          >
                            {pct.toFixed(2)}%
                          </td>
                          <td className="max-w-[200px] px-4 py-3 text-[11px] leading-snug text-gray-500">
                            P&amp;L is summed broker MTOM (₹) on open legs at trigger — useful for reviews; finalize
                            with contract note if needed.
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={id}>
                        <td className="px-4 py-2 text-xs text-gray-500" colSpan={7}>
                          Unknown record type: {rt}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["week", "Weekly"],
                ["month", "Monthly"],
                ["year", "Yearly"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setPnlPeriod(key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  pnlPeriod === key
                    ? "bg-emerald-700 text-white"
                    : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900/40">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                <thead className="border-b border-gray-700 bg-gray-950/90 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  <tr>
                    <th className="px-4 py-3">Period</th>
                    <th className="px-4 py-3 text-right">Trades</th>
                    <th className="px-4 py-3 text-right">Wins</th>
                    <th className="px-4 py-3 text-right">Losses</th>
                    <th className="px-4 py-3 text-right">Total P&amp;L</th>
                    <th className="px-4 py-3 text-right">Avg / trade</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/80">
                  {pnlQ.isLoading ? (
                    <tr>
                      <td className="px-4 py-8 text-gray-500" colSpan={6}>
                        Loading…
                      </td>
                    </tr>
                  ) : !pnlQ.data?.mongoConfigured ? (
                    <tr>
                      <td className="px-4 py-8 text-gray-500" colSpan={6}>
                        Configure MongoDB to see P&amp;L rollups.
                      </td>
                    </tr>
                  ) : (pnlQ.data?.buckets ?? []).length === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-gray-500" colSpan={6}>
                        No closed portfolio exits in the journal yet.
                      </td>
                    </tr>
                  ) : (
                    pnlQ.data!.buckets.map((b) => (
                      <tr key={b.bucket} className="hover:bg-gray-800/30">
                        <td className="px-4 py-3 font-mono text-xs text-gray-200">{b.label}</td>
                        <td className="px-4 py-3 text-right font-mono text-gray-300">{b.tradeCount}</td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-400">{b.wins}</td>
                        <td className="px-4 py-3 text-right font-mono text-rose-400">{b.losses}</td>
                        <td
                          className={`px-4 py-3 text-right font-mono font-semibold ${
                            b.totalPnlRupees >= 0 ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {formatInr(b.totalPnlRupees)}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-mono text-xs ${
                            b.avgPnlRupees >= 0 ? "text-emerald-400/90" : "text-rose-400/90"
                          }`}
                        >
                          {formatInr(b.avgPnlRupees)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-[11px] text-gray-600">
            Buckets use market-time partitions in Asia/Kolkata. Totals include only{" "}
            <span className="text-gray-500">PORTFOLIO_EXIT</span> rows (full book closes).
          </p>
        </div>
      )}
    </div>
  );
}
