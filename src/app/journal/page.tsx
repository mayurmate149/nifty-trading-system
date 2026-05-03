"use client";

/**
 * Professional trade journal — automatic entries from Pro Desk executions
 * and portfolio exits (manual / trailing auto-exit). Rich detail (Greeks, IV, OI,
 * structure metrics, market context) is captured on both sides for review.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

type TabKey = "activity" | "pnl";
type PnlPeriod = "day" | "week" | "month" | "year";

// ─── Formatting helpers ───────────────────────

function formatInr(n: number, withDecimals = false) {
  if (!Number.isFinite(n)) return "₹0";
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(n);
  const opts: Intl.NumberFormatOptions = withDecimals
    ? { minimumFractionDigits: 0, maximumFractionDigits: 2 }
    : { maximumFractionDigits: 0 };
  return `${sign}₹${v.toLocaleString("en-IN", opts)}`;
}

function formatNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatLakh(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n === 0) return "—";
  if (Math.abs(n) >= 100000) return `${(n / 100000).toFixed(2)}L`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}

function istDateTime(iso: string | Date | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatDuration(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return "—";
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  if (m < 1) return `${sec}s`;
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return rm ? `${h}h ${rm}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

function formatHoldingMin(min: number | null): string {
  if (min === null || !Number.isFinite(min) || min <= 0) return "—";
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const rm = Math.round(min % 60);
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

// ─── UI primitives ────────────────────────────

function PnlValue({
  value,
  size = "sm",
  withDecimals = false,
}: {
  value: number;
  size?: "xs" | "sm" | "lg";
  withDecimals?: boolean;
}) {
  const cls = value > 0 ? "text-emerald-400" : value < 0 ? "text-rose-400" : "text-gray-400";
  const sizeCls = size === "lg" ? "text-2xl font-bold" : size === "xs" ? "text-[11px]" : "text-sm font-semibold";
  return <span className={`font-mono ${sizeCls} ${cls}`}>{formatInr(value, withDecimals)}</span>;
}

function StatTile({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string | React.ReactNode;
  sub?: string;
  tone?: "default" | "good" | "bad" | "warn";
}) {
  const toneCls =
    tone === "good"
      ? "border-emerald-800/40 bg-emerald-950/20"
      : tone === "bad"
        ? "border-rose-800/40 bg-rose-950/20"
        : tone === "warn"
          ? "border-amber-800/40 bg-amber-950/20"
          : "border-gray-800/70 bg-gray-900/40";
  return (
    <div className={`rounded-xl border ${toneCls} px-4 py-3`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-gray-100">{value}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-gray-500">{sub}</div> : null}
    </div>
  );
}

function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "bad" | "warn" | "info";
}) {
  const map = {
    neutral: "bg-gray-800 text-gray-300",
    good: "bg-emerald-900/50 text-emerald-300",
    bad: "bg-rose-900/50 text-rose-300",
    warn: "bg-amber-900/50 text-amber-200",
    info: "bg-violet-900/50 text-violet-200",
  } as const;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${map[tone]}`}>
      {children}
    </span>
  );
}

// ─── Page ─────────────────────────────────────

export default function JournalPage() {
  const [tab, setTab] = useState<TabKey>("activity");
  const [pnlPeriod, setPnlPeriod] = useState<PnlPeriod>("day");

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

  const records = (journalQ.data?.records ?? []) as Array<Record<string, unknown>>;
  const mongoConfigured = journalQ.data?.mongoConfigured ?? false;

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Trading journal</h1>
          <p className="mt-1 text-sm text-gray-500">
            Auto-logged from Pro Desk executions and book exits. Captures structure, Greeks, IV,
            OI, market context — everything you need to review setups and refine discipline.
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
        <ActivityLog records={records} loading={journalQ.isLoading} />
      ) : (
        <PnlView period={pnlPeriod} setPeriod={setPnlPeriod} q={pnlQ} />
      )}
    </div>
  );
}

// ─── Activity log ─────────────────────────────

function ActivityLog({
  records,
  loading,
}: {
  records: Array<Record<string, unknown>>;
  loading: boolean;
}) {
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.journal.remove(id),
    onMutate: (id) => setPendingId(id),
    onSettled: () => setPendingId(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["journal"] });
      queryClient.invalidateQueries({ queryKey: ["journal-pnl"] });
    },
    onError: (err) => {
      window.alert(err instanceof Error ? err.message : "Delete failed");
    },
  });

  const handleDelete = (id: string, summary: string) => {
    if (!id) return;
    if (
      !window.confirm(
        `Delete this journal entry?\n\n${summary}\n\nThis cannot be undone.`,
      )
    ) {
      return;
    }
    deleteMutation.mutate(id);
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-8 text-center text-sm text-gray-500">
        Loading journal…
      </div>
    );
  }
  if (records.length === 0) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-8 text-center text-sm text-gray-500">
        No journal rows yet. Execute from Pro Desk or close the book via auto-exit / exit all.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {records.map((row) => {
        const id = String(row.id ?? row._id ?? Math.random());
        const isDeleting = pendingId === id;
        if (row.recordType === "OPEN_ENTRY") {
          return <EntryRow key={id} row={row} onDelete={handleDelete} isDeleting={isDeleting} />;
        }
        if (row.recordType === "PORTFOLIO_EXIT") {
          return <ExitRow key={id} row={row} onDelete={handleDelete} isDeleting={isDeleting} />;
        }
        return null;
      })}
    </div>
  );
}

function DeleteButton({
  onClick,
  isDeleting,
  size = "sm",
}: {
  onClick: (e: React.MouseEvent) => void;
  isDeleting: boolean;
  size?: "sm" | "xs";
}) {
  const sizing = size === "xs" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]";
  return (
    <button
      type="button"
      disabled={isDeleting}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className={`rounded-md border border-rose-800/50 bg-rose-950/30 font-semibold uppercase tracking-wide text-rose-300 transition hover:border-rose-700 hover:bg-rose-900/40 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-50 ${sizing}`}
      title="Delete this journal record"
    >
      {isDeleting ? "Deleting…" : "Delete"}
    </button>
  );
}

// ─── Entry row ────────────────────────────────

function EntryRow({
  row,
  onDelete,
  isDeleting,
}: {
  row: Record<string, unknown>;
  onDelete: (id: string, summary: string) => void;
  isDeleting: boolean;
}) {
  const [open, setOpen] = useState(false);
  const legs = (row.entryLegs as Array<Record<string, unknown>>) ?? [];
  const strat = (row.strategy as Record<string, unknown> | null) ?? null;
  const metrics = (strat?.metrics as Record<string, unknown> | undefined) ?? undefined;
  const ctx = (row.marketContext as Record<string, unknown> | undefined) ?? undefined;
  const lifecycle = String(row.lifecycle ?? "OPEN");
  const allOk = Boolean(row.allEntryOrdersOk);
  const netPremium = Number(row.netPremiumRupees ?? 0);
  const opened = (row.openedAt as string) ?? (row.createdAt as string);
  const recordId = String(row.id ?? "");

  const tradeType = (strat?.tradeType as string | undefined) ?? "Execute-scan";
  const direction = (strat?.direction as string | undefined) ?? null;
  const edge = (strat?.edge as string | undefined) ?? null;
  const rationale = (strat?.rationale as string[] | undefined) ?? [];

  const summary = `${tradeType}${direction ? ` · ${direction}` : ""} · ${legs.length} leg(s) @ ${istDateTime(opened)}`;

  return (
    <div className="overflow-hidden rounded-xl border border-violet-800/30 bg-gray-900/40 transition hover:border-violet-700/50">
      <div
        role="button"
        tabIndex={0}
        className="flex w-full cursor-pointer flex-wrap items-start justify-between gap-3 px-4 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-gray-400">{istDateTime(opened)}</span>
            <Pill tone="info">ENTRY · {tradeType}</Pill>
            {direction ? <Pill tone={direction === "BULLISH" ? "good" : direction === "BEARISH" ? "bad" : "warn"}>{direction}</Pill> : null}
            <Pill tone={lifecycle === "OPEN" ? "warn" : "neutral"}>{lifecycle}</Pill>
            {!allOk ? <Pill tone="bad">Some legs failed</Pill> : null}
          </div>
          {edge ? <div className="line-clamp-1 text-sm text-gray-300">{edge}</div> : null}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
            <span>{legs.length} leg(s) · {Number(row.quantityLot ?? 0)} qty/leg</span>
            <span>
              Net premium <span className={netPremium >= 0 ? "text-emerald-400" : "text-rose-400"}>
                {formatInr(netPremium, true)}
              </span>{" "}
              ({netPremium >= 0 ? "credit" : "debit"})
            </span>
            {metrics?.maxProfit !== undefined ? (
              <span>
                MaxP <span className="text-emerald-400/80">{formatInr(Number(metrics.maxProfit))}</span> · MaxL{" "}
                <span className="text-rose-400/80">{formatInr(Number(metrics.maxLoss ?? 0))}</span>
              </span>
            ) : null}
            {metrics?.winProbability !== undefined ? (
              <span>WinProb {formatNum(Number(metrics.winProbability), 1)}%</span>
            ) : null}
            {metrics?.expectedValue !== undefined ? (
              <span>
                EV <span className={Number(metrics.expectedValue) >= 0 ? "text-emerald-400/80" : "text-rose-400/80"}>
                  {formatInr(Number(metrics.expectedValue))}
                </span>
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">{open ? "Hide ▴" : "Details ▾"}</span>
          {recordId ? (
            <DeleteButton
              isDeleting={isDeleting}
              onClick={() => onDelete(recordId, summary)}
            />
          ) : null}
        </div>
      </div>

      {open ? (
        <div className="border-t border-gray-800 bg-gray-950/40 px-4 py-4">
          {ctx ? <MarketContextBar ctx={ctx} title="Market context at entry" /> : null}

          {metrics ? <StrategyMetricsGrid metrics={metrics} /> : null}

          {rationale && rationale.length > 0 ? (
            <div className="mt-3 rounded-lg border border-gray-800/70 bg-gray-900/30 p-3">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                Rationale
              </div>
              <ul className="list-inside list-disc space-y-0.5 text-[12px] text-gray-300">
                {rationale.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <EntryLegsTable legs={legs} />
        </div>
      ) : null}
    </div>
  );
}

function StrategyMetricsGrid({ metrics }: { metrics: Record<string, unknown> }) {
  const m = metrics;
  const items: Array<[string, string | React.ReactNode]> = [];
  if (m.maxProfit !== undefined) items.push(["Max profit", formatInr(Number(m.maxProfit))]);
  if (m.maxLoss !== undefined) items.push(["Max loss", formatInr(Number(m.maxLoss))]);
  if (m.riskReward !== undefined) items.push(["Risk:Reward", `1 : ${formatNum(Number(m.riskReward), 2)}`]);
  if (m.marginRequired !== undefined) items.push(["Margin", formatInr(Number(m.marginRequired))]);
  if (m.winProbability !== undefined) items.push(["Win probability", `${formatNum(Number(m.winProbability), 1)}%`]);
  if (m.expectedValue !== undefined)
    items.push(["Expected value", <PnlValue key="ev" value={Number(m.expectedValue)} size="sm" />]);
  if (m.kellyScore !== undefined) items.push(["Kelly score", formatNum(Number(m.kellyScore), 2)]);
  if (m.thetaDecayPerDay !== undefined) items.push(["Theta / day", formatInr(Number(m.thetaDecayPerDay))]);
  if (m.score !== undefined) items.push(["Composite score", `${formatNum(Number(m.score), 0)} / 100`]);
  if (Array.isArray(m.breakeven) && m.breakeven.length > 0)
    items.push(["Breakeven", (m.breakeven as number[]).map((b) => formatNum(b, 0)).join(" / ")]);
  if (m.targetTime) items.push(["Target time", String(m.targetTime)]);
  if (m.oiWall) items.push(["OI wall", String(m.oiWall)]);

  if (items.length === 0) return null;
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg border border-gray-800/70 bg-gray-900/30 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{label}</div>
          <div className="mt-0.5 text-[13px] text-gray-200">{value}</div>
        </div>
      ))}
      {Array.isArray(m.warnings) && (m.warnings as string[]).length > 0 ? (
        <div className="col-span-full rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-[12px] text-amber-200">
          <span className="font-semibold">Warnings: </span>
          {(m.warnings as string[]).join(" · ")}
        </div>
      ) : null}
    </div>
  );
}

function EntryLegsTable({ legs }: { legs: Array<Record<string, unknown>> }) {
  if (legs.length === 0) return null;
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-gray-800/70">
      <table className="w-full min-w-[820px] border-collapse text-left text-xs">
        <thead className="bg-gray-950/80 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          <tr>
            <th className="px-3 py-2">Side</th>
            <th className="px-3 py-2">Strike</th>
            <th className="px-3 py-2 text-right">Qty</th>
            <th className="px-3 py-2 text-right">Limit</th>
            <th className="px-3 py-2 text-right">Premium ₹</th>
            <th className="px-3 py-2 text-right">IV</th>
            <th className="px-3 py-2 text-right">Δ</th>
            <th className="px-3 py-2 text-right">Γ</th>
            <th className="px-3 py-2 text-right">Θ</th>
            <th className="px-3 py-2 text-right">ν</th>
            <th className="px-3 py-2 text-right">OI / ΔOI</th>
            <th className="px-3 py-2 text-right">Vol</th>
            <th className="px-3 py-2">Order</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/70 text-gray-200">
          {legs.map((l, i) => {
            const action = String(l.action ?? "");
            const ot = (l.optionType as string | undefined) ?? "";
            const greeks = (l.greeks as Record<string, unknown> | undefined) ?? undefined;
            const ok = Boolean(l.ok);
            return (
              <tr key={i} className={ok ? "" : "bg-rose-950/20"}>
                <td className="px-3 py-2">
                  <Pill tone={action === "SELL" ? "good" : "info"}>
                    {action} {ot}
                  </Pill>
                </td>
                <td className="px-3 py-2 font-mono">{formatNum(Number(l.strike ?? 0), 0)}</td>
                <td className="px-3 py-2 text-right font-mono">{Number(l.quantity ?? 0)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatNum(Number(l.limitPrice ?? 0), 2)}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {formatInr(Number(l.legPremiumRupees ?? 0))}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {greeks?.iv !== undefined ? `${formatNum(Number(greeks.iv), 1)}%` : "—"}
                </td>
                <td className="px-3 py-2 text-right font-mono">{formatNum(Number(greeks?.delta ?? NaN), 3)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatNum(Number(greeks?.gamma ?? NaN), 4)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatNum(Number(greeks?.theta ?? NaN), 3)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatNum(Number(greeks?.vega ?? NaN), 3)}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-400">
                  {formatLakh(Number(l.oi ?? 0))} / {formatLakh(Number(l.changeInOi ?? 0))}
                </td>
                <td className="px-3 py-2 text-right font-mono text-gray-400">{formatLakh(Number(l.volume ?? 0))}</td>
                <td className="px-3 py-2 text-[11px]">
                  {ok ? (
                    <span className="font-mono text-gray-400">{l.orderId ? String(l.orderId) : "✓"}</span>
                  ) : (
                    <span className="text-rose-400">{String(l.error ?? "Failed")}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Exit row ─────────────────────────────────

function ExitRow({
  row,
  onDelete,
  isDeleting,
}: {
  row: Record<string, unknown>;
  onDelete: (id: string, summary: string) => void;
  isDeleting: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pnl = Number(row.pnlRupees ?? 0);
  const pct = Number(row.portfolioPnlPct ?? 0);
  const reason = String(row.exitReason ?? "");
  const src = String(row.source ?? "");
  const ok = Number(row.exitSuccessCount ?? 0);
  const fail = Number(row.exitFailCount ?? 0);
  const closed = (row.closedAt as string) ?? (row.createdAt as string);
  const legs = (row.legsAtExit as Array<Record<string, unknown>>) ?? [];
  const exitOrders = (row.exitOrders as Array<Record<string, unknown>>) ?? [];
  const ctx = (row.marketContext as Record<string, unknown> | undefined) ?? undefined;
  const agg = (row.aggregatedGreeks as Record<string, unknown> | undefined) ?? undefined;
  const holdMs = Number(row.holdingDurationMs ?? 0) || null;
  const reasonLabel = reason.replace(/_/g, " ");
  const recordId = String(row.id ?? "");

  const win = pnl >= 0;
  const tone = win ? "border-emerald-800/40 bg-emerald-950/10 hover:border-emerald-700/60"
                   : "border-rose-800/40 bg-rose-950/10 hover:border-rose-700/60";

  const summary = `EXIT · ${reasonLabel} · P&L ${formatInr(pnl, true)} (${pct >= 0 ? "+" : ""}${formatNum(pct, 2)}%) @ ${istDateTime(closed)}`;

  return (
    <div className={`overflow-hidden rounded-xl border ${tone} transition`}>
      <div
        role="button"
        tabIndex={0}
        className="flex w-full cursor-pointer flex-wrap items-start justify-between gap-3 px-4 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] text-gray-400">{istDateTime(closed)}</span>
            <Pill tone={win ? "good" : "bad"}>EXIT · {reasonLabel}</Pill>
            <Pill tone="neutral">{src.replace(/-/g, " ")}</Pill>
            {fail > 0 ? <Pill tone="warn">{fail} order(s) failed</Pill> : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-gray-500">
            <span>{Number(row.legCount ?? 0)} leg(s) closed · orders {ok} ok / {fail} failed</span>
            {holdMs ? <span>Held {formatDuration(holdMs)}</span> : null}
            {Number(row.capitalAtSnapshot ?? 0) > 0 ? (
              <span>Capital {formatInr(Number(row.capitalAtSnapshot))}</span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <PnlValue value={pnl} size="lg" withDecimals />
          <span className={`font-mono text-xs ${pct >= 0 ? "text-emerald-400/90" : "text-rose-400/90"}`}>
            {pct >= 0 ? "+" : ""}{formatNum(pct, 2)}%
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-500">{open ? "Hide ▴" : "Details ▾"}</span>
            {recordId ? (
              <DeleteButton
                isDeleting={isDeleting}
                onClick={() => onDelete(recordId, summary)}
              />
            ) : null}
          </div>
        </div>
      </div>

      {open ? (
        <div className="border-t border-gray-800 bg-gray-950/40 px-4 py-4">
          {ctx ? <MarketContextBar ctx={ctx} title="Market context at exit" /> : null}

          {agg ? <AggregatedGreeksGrid agg={agg} /> : null}

          <ExitLegsTable legs={legs} />

          {exitOrders.length > 0 ? <ExitOrdersTable orders={exitOrders} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function AggregatedGreeksGrid({ agg }: { agg: Record<string, unknown> }) {
  return (
    <div className="mt-3 rounded-lg border border-gray-800/70 bg-gray-900/30 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        Portfolio Greeks at exit (signed by net qty)
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <GreekTile label="Net Δ" value={Number(agg.netDelta ?? 0)} digits={3} />
        <GreekTile label="Net Γ" value={Number(agg.netGamma ?? 0)} digits={4} />
        <GreekTile label="Net Θ" value={Number(agg.netTheta ?? 0)} digits={3} />
        <GreekTile label="Net ν" value={Number(agg.netVega ?? 0)} digits={3} />
      </div>
      <p className="mt-2 text-[11px] text-gray-500">
        Δ near zero = direction-neutral · Θ negative = paying time decay · ν positive = long volatility.
      </p>
    </div>
  );
}

function GreekTile({ label, value, digits }: { label: string; value: number; digits: number }) {
  return (
    <div className="rounded-md bg-gray-900/60 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-gray-200">{formatNum(value, digits)}</div>
    </div>
  );
}

function ExitLegsTable({ legs }: { legs: Array<Record<string, unknown>> }) {
  if (legs.length === 0) return null;
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-gray-800/70">
      <table className="w-full min-w-[860px] border-collapse text-left text-xs">
        <thead className="bg-gray-950/80 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          <tr>
            <th className="px-3 py-2">Symbol</th>
            <th className="px-3 py-2">Strike</th>
            <th className="px-3 py-2 text-right">Qty (signed)</th>
            <th className="px-3 py-2 text-right">Avg ₹</th>
            <th className="px-3 py-2 text-right">LTP ₹</th>
            <th className="px-3 py-2 text-right">MTOM ₹</th>
            <th className="px-3 py-2 text-right">Δ</th>
            <th className="px-3 py-2 text-right">Γ</th>
            <th className="px-3 py-2 text-right">Θ</th>
            <th className="px-3 py-2 text-right">ν</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/70 text-gray-200">
          {legs.map((l, i) => {
            const greeks = (l.greeks as Record<string, unknown> | undefined) ?? undefined;
            const mtm = Number(l.mtmRupee ?? 0);
            const ot = (l.optionType as string | undefined) ?? "";
            return (
              <tr key={i}>
                <td className="px-3 py-2 font-mono text-[11px] text-gray-300">{String(l.symbol ?? "—")}</td>
                <td className="px-3 py-2 font-mono">
                  {l.strike ? formatNum(Number(l.strike), 0) : "—"} {ot}
                </td>
                <td className={`px-3 py-2 text-right font-mono ${Number(l.quantity) < 0 ? "text-rose-400" : "text-emerald-400"}`}>
                  {Number(l.quantity ?? 0)}
                </td>
                <td className="px-3 py-2 text-right font-mono">{formatNum(Number(l.avgPrice ?? 0), 2)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatNum(Number(l.ltp ?? 0), 2)}</td>
                <td className={`px-3 py-2 text-right font-mono ${mtm >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {formatInr(mtm, true)}
                </td>
                <td className="px-3 py-2 text-right font-mono">{formatNum(Number(greeks?.delta ?? NaN), 3)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatNum(Number(greeks?.gamma ?? NaN), 4)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatNum(Number(greeks?.theta ?? NaN), 3)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatNum(Number(greeks?.vega ?? NaN), 3)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ExitOrdersTable({ orders }: { orders: Array<Record<string, unknown>> }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-gray-800/70">
      <table className="w-full min-w-[700px] border-collapse text-left text-xs">
        <thead className="bg-gray-950/80 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          <tr>
            <th className="px-3 py-2">Side</th>
            <th className="px-3 py-2">Symbol</th>
            <th className="px-3 py-2 text-right">Qty</th>
            <th className="px-3 py-2 text-right">Limit ₹</th>
            <th className="px-3 py-2 text-right">LTP ₹</th>
            <th className="px-3 py-2 text-right">MTOM ₹</th>
            <th className="px-3 py-2">Order</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/70 text-gray-200">
          {orders.map((o, i) => {
            const ok = Boolean(o.ok);
            const side = String(o.buySell ?? "");
            return (
              <tr key={i} className={ok ? "" : "bg-rose-950/20"}>
                <td className="px-3 py-2">
                  <Pill tone={side === "B" ? "info" : "good"}>{side === "B" ? "BUY (close)" : "SELL (close)"}</Pill>
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-gray-300">{String(o.symbol ?? "—")}</td>
                <td className="px-3 py-2 text-right font-mono">{Number(o.quantity ?? 0)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatNum(Number(o.limitPrice ?? 0), 2)}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {o.ltpAtExit !== undefined ? formatNum(Number(o.ltpAtExit), 2) : "—"}
                </td>
                <td className="px-3 py-2 text-right font-mono">{formatInr(Number(o.mtmRupeeBeforeExit ?? 0), true)}</td>
                <td className="px-3 py-2 text-[11px]">
                  {ok ? (
                    <span className="font-mono text-gray-400">{o.orderId ? String(o.orderId) : "✓"}</span>
                  ) : (
                    <span className="text-rose-400">{String(o.error ?? "Failed")}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Market context bar ───────────────────────

function MarketContextBar({ ctx, title }: { ctx: Record<string, unknown>; title: string }) {
  const items: Array<[string, string]> = [];
  if (ctx.spot !== undefined) {
    items.push([
      "Spot",
      `${formatNum(Number(ctx.spot), 1)}${
        ctx.spotChangePct !== undefined
          ? ` (${Number(ctx.spotChangePct) >= 0 ? "+" : ""}${formatNum(Number(ctx.spotChangePct), 2)}%)`
          : ""
      }`,
    ]);
  }
  if (ctx.vix !== undefined) items.push(["VIX", formatNum(Number(ctx.vix), 2)]);
  if (ctx.pcr !== undefined && Number(ctx.pcr) > 0) items.push(["PCR", formatNum(Number(ctx.pcr), 2)]);
  if (ctx.ivPercentile !== undefined && Number(ctx.ivPercentile) > 0)
    items.push(["IV %ile", `${formatNum(Number(ctx.ivPercentile), 0)}%`]);
  if (ctx.trend) items.push(["Trend", String(ctx.trend)]);
  if (ctx.daysToExpiry !== undefined) items.push(["DTE", `${formatNum(Number(ctx.daysToExpiry), 0)}d`]);
  if (ctx.expiry) items.push(["Expiry", String(ctx.expiry)]);

  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-gray-800/70 bg-gray-900/30 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">{title}</div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-gray-300">
        {items.map(([k, v]) => (
          <div key={k}>
            <span className="text-gray-500">{k}: </span>
            <span className="font-mono">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── P&L view ─────────────────────────────────

interface PnlBucket {
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
}

interface PnlOverall {
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
}

function PnlView({
  period,
  setPeriod,
  q,
}: {
  period: PnlPeriod;
  setPeriod: (p: PnlPeriod) => void;
  q: ReturnType<typeof useQuery<{
    mongoConfigured?: boolean;
    period: string;
    buckets: PnlBucket[];
    overall?: PnlOverall;
  }>>;
}) {
  const buckets = q.data?.buckets ?? [];
  const overall = q.data?.overall;

  // Fallback for older API responses without `overall` (compute client-side from buckets).
  const computedOverall = useMemo<PnlOverall | null>(() => {
    if (overall) return overall;
    if (buckets.length === 0) return null;
    const wins = buckets.reduce((a, b) => a + b.wins, 0);
    const losses = buckets.reduce((a, b) => a + b.losses, 0);
    const total = buckets.reduce((a, b) => a + b.totalPnlRupees, 0);
    const trades = wins + losses;
    return {
      totalPnlRupees: total,
      tradeCount: trades,
      wins,
      losses,
      winRatePct: trades === 0 ? 0 : (wins / trades) * 100,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: null,
      bestTrade: 0,
      worstTrade: 0,
      expectancy: trades === 0 ? 0 : total / trades,
      avgHoldingMin: null,
    };
  }, [overall, buckets]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["day", "Daily"],
            ["month", "Monthly"],
            ["year", "Yearly"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setPeriod(key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              period === key
                ? "bg-emerald-700 text-white"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-8 text-center text-sm text-gray-500">
          Loading P&amp;L summary…
        </div>
      ) : !q.data?.mongoConfigured ? (
        <div className="rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-100">
          Configure MongoDB to see P&amp;L rollups.
        </div>
      ) : (
        <>
          {computedOverall ? <OverallKpis o={computedOverall} period={period} /> : null}

          <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900/40">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] border-collapse text-left text-sm">
                <thead className="border-b border-gray-700 bg-gray-950/90 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  <tr>
                    <th className="px-4 py-3">Period</th>
                    <th className="px-4 py-3 text-right">Trades</th>
                    <th className="px-4 py-3 text-right">Win rate</th>
                    <th className="px-4 py-3 text-right">Total P&amp;L</th>
                    <th className="px-4 py-3 text-right">Expectancy</th>
                    <th className="px-4 py-3 text-right">Avg win</th>
                    <th className="px-4 py-3 text-right">Avg loss</th>
                    <th className="px-4 py-3 text-right">Profit factor</th>
                    <th className="px-4 py-3 text-right">Best</th>
                    <th className="px-4 py-3 text-right">Worst</th>
                    <th className="px-4 py-3 text-right">Avg hold</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/80">
                  {buckets.length === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-gray-500" colSpan={11}>
                        No closed portfolio exits in the journal yet.
                      </td>
                    </tr>
                  ) : (
                    buckets.map((b) => (
                      <tr key={b.bucket} className="hover:bg-gray-800/30">
                        <td className="px-4 py-3 font-mono text-xs text-gray-200">{b.label}</td>
                        <td className="px-4 py-3 text-right font-mono text-gray-300">
                          {b.tradeCount}
                          <span className="ml-1 text-[10px] text-gray-500">
                            ({b.wins}W/{b.losses}L)
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-gray-300">
                          {formatNum(b.winRatePct, 1)}%
                        </td>
                        <td className={`px-4 py-3 text-right font-mono font-semibold ${b.totalPnlRupees >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                          {formatInr(b.totalPnlRupees)}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono text-xs ${b.expectancy >= 0 ? "text-emerald-400/90" : "text-rose-400/90"}`}>
                          {formatInr(b.expectancy)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-400/80">
                          {b.avgWin === 0 ? "—" : formatInr(b.avgWin)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-rose-400/80">
                          {b.avgLoss === 0 ? "—" : formatInr(b.avgLoss)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-gray-300">
                          {b.profitFactor === null ? "∞" : formatNum(b.profitFactor, 2)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-400/80">
                          {b.bestTrade ? formatInr(b.bestTrade) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-rose-400/80">
                          {b.worstTrade ? formatInr(b.worstTrade) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-gray-400">
                          {formatHoldingMin(b.avgHoldingMin)}
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
            <span className="text-gray-500">PORTFOLIO_EXIT</span> rows (full book closes). Profit factor =
            gross profit ÷ |gross loss|; ∞ when no losers. Expectancy = average ₹ per trade.
          </p>
        </>
      )}
    </div>
  );
}

function OverallKpis({ o, period }: { o: PnlOverall; period: PnlPeriod }) {
  const periodLabel =
    period === "day"
      ? "daily"
      : period === "week"
        ? "weekly"
        : period === "month"
          ? "monthly"
          : "yearly";
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <StatTile
        label={`Net P&L (all ${periodLabel} buckets)`}
        value={<PnlValue value={o.totalPnlRupees} size="lg" />}
        sub={`${o.tradeCount} trade(s)`}
        tone={o.totalPnlRupees >= 0 ? "good" : "bad"}
      />
      <StatTile
        label="Win rate"
        value={`${formatNum(o.winRatePct, 1)}%`}
        sub={`${o.wins}W / ${o.losses}L`}
      />
      <StatTile
        label="Profit factor"
        value={o.profitFactor === null ? "∞" : formatNum(o.profitFactor, 2)}
        sub="gross win ÷ |gross loss|"
        tone={
          o.profitFactor === null
            ? "good"
            : o.profitFactor >= 1.5
              ? "good"
              : o.profitFactor >= 1
                ? "warn"
                : "bad"
        }
      />
      <StatTile
        label="Expectancy / trade"
        value={<PnlValue value={o.expectancy} size="sm" withDecimals />}
        sub="₹ average outcome"
        tone={o.expectancy >= 0 ? "good" : "bad"}
      />
      <StatTile
        label="Best / Worst"
        value={
          <div className="flex flex-col gap-0.5 text-sm">
            <span className="font-mono text-emerald-400">{formatInr(o.bestTrade)}</span>
            <span className="font-mono text-rose-400">{formatInr(o.worstTrade)}</span>
          </div>
        }
        sub="single trade"
      />
      <StatTile label="Avg holding" value={formatHoldingMin(o.avgHoldingMin)} sub="time in trade" />
    </div>
  );
}
