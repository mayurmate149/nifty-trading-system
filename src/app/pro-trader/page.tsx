"use client";

/**
 * Pro Trader — Multi-Strategy Desk
 *
 * Every configured strategy is monitored continuously against the live chain
 * AND a full technical stack (RSI, EMA 9/21, VWAP, SuperTrend, ATR, MACD,
 * Bollinger, Stochastic, momentum/ROC, volume spike, OI walls, OI flow,
 * max pain, PCR, IV percentile). When a strategy's rule set lines up, its
 * status turns READY and its Enter trade button is enabled.
 */

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ─── Types (mirror server) ──────────────────────────────────────────────────

type StrategyKey =
  | "BULL_CALL_SPREAD"
  | "BULL_PUT_SPREAD"
  | "BEAR_PUT_SPREAD"
  | "BEAR_CALL_SPREAD"
  | "IRON_FLY"
  | "SHORT_IRON_CONDOR"
  | "DIRECTIONAL_BUY"
  | "NAKED_BUY";

type Status = "READY" | "ARMED" | "WAIT" | "AVOID";

type RuleGroup =
  | "trend"
  | "momentum"
  | "volatility"
  | "option_chain"
  | "structure"
  | "volume";

interface MonitorRule {
  id: string;
  group: RuleGroup;
  label: string;
  weight: 1 | 2 | 3;
  critical: boolean;
  passed: boolean;
  detail: string;
}

interface MonitorGroup {
  group: RuleGroup;
  passed: number;
  total: number;
  weightPassed: number;
  weightTotal: number;
}

interface MonitorPickLeg {
  action: "BUY" | "SELL";
  optionType: "CE" | "PE";
  strike: number;
  premium: number;
  iv: number;
  oi: number;
  scripCode?: number;
}

interface MonitorPick {
  legs: MonitorPickLeg[];
  netCredit: number;
  maxProfit: number;
  maxLoss: number;
  breakeven: number[];
  marginEstimate: number;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
}

interface StrategyCard {
  key: StrategyKey;
  name: string;
  icon: string;
  bias: "CREDIT" | "DEBIT";
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  legs: number;
  riskProfile: "LIMITED" | "UNLIMITED";
  summary: string;
  status: Status;
  matchPct: number;
  headline: string;
  rules: MonitorRule[];
  groups: MonitorGroup[];
  criticalsFailed: MonitorRule[];
  pick: MonitorPick | null;
  exitRules: {
    stopLoss: string;
    target: string;
    trailingSL: string;
    timeExit: string;
  };
  fingerprint: string;
}

interface MonitorSnapshot {
  generatedAt: string;
  marketContext: {
    spot: number;
    spotChange: number;
    spotChangePct: number;
    vix: number;
    pcr: number;
    trend: string;
    trendStrength: number;
    ivPercentile: number;
    daysToExpiry: number;
    expiry: string;
    atmStrike: number;
    maxCallOI: { strike: number; oi: number };
    maxPutOI: { strike: number; oi: number };
    maxPain: number;
    atmStraddle: number;
    expectedMovePts: number;
    rsi: number;
    ema9: number;
    ema21: number;
    emaCrossover: "BULLISH" | "BEARISH" | "NEUTRAL";
    superTrendSignal: "BUY" | "SELL";
    vwap: number;
    priceVsVwap: "ABOVE" | "BELOW" | "AT";
    macdBias: "BULLISH" | "BEARISH" | "NEUTRAL" | null;
    bollingerPosition: string | null;
    bollingerWidthPct: number | null;
    stochasticZone: "OVERBOUGHT" | "OVERSOLD" | "NEUTRAL" | null;
  };
  counts: { ready: number; armed: number; wait: number; avoid: number };
  strategies: StrategyCard[];
  error?: string;
}

interface TriggerEvent {
  id: string;
  at: string;
  strategy: StrategyKey;
  name: string;
  from: Status;
  to: Status;
  headline: string;
}

// ─── Tokens ─────────────────────────────────────────────────────────────────

const REFRESH_OPTIONS = [
  { label: "3s", value: 3000 },
  { label: "5s", value: 5000 },
  { label: "10s", value: 10000 },
  { label: "30s", value: 30000 },
  { label: "Off", value: 0 },
];

const STATUS_STYLE: Record<
  Status,
  { dot: string; badge: string; ring: string; label: string; bar: string }
> = {
  READY: {
    dot: "bg-emerald-400 shadow-emerald-500/60",
    badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
    ring: "ring-emerald-500/40 border-emerald-500/60",
    label: "READY",
    bar: "bg-emerald-400",
  },
  ARMED: {
    dot: "bg-amber-400 shadow-amber-500/60",
    badge: "bg-amber-500/15 text-amber-300 border-amber-500/40",
    ring: "ring-amber-500/30 border-amber-500/40",
    label: "ARMED",
    bar: "bg-amber-400",
  },
  WAIT: {
    dot: "bg-slate-500",
    badge: "bg-slate-700/60 text-slate-300 border-slate-600",
    ring: "ring-slate-700 border-slate-700",
    label: "WAIT",
    bar: "bg-slate-500",
  },
  AVOID: {
    dot: "bg-rose-500",
    badge: "bg-rose-500/10 text-rose-300 border-rose-500/30",
    ring: "ring-rose-500/20 border-rose-500/30",
    label: "AVOID",
    bar: "bg-rose-500",
  },
};

const GROUP_LABELS: Record<RuleGroup, string> = {
  trend: "Trend",
  momentum: "Momentum",
  volatility: "Volatility",
  option_chain: "Option chain",
  structure: "Structure",
  volume: "Volume",
};

const GROUP_ICONS: Record<RuleGroup, string> = {
  trend: "📈",
  momentum: "⚡",
  volatility: "🌡",
  option_chain: "🧮",
  structure: "📐",
  volume: "📊",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatINR(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_00_000) return `₹${(n / 1_00_000).toFixed(2)}L`;
  if (Math.abs(n) >= 1_000) return `₹${(n / 1_000).toFixed(1)}k`;
  return `₹${Math.round(n)}`;
}

function formatTrend(t: string): string {
  if (t === "trend-up") return "Uptrend";
  if (t === "trend-down") return "Downtrend";
  return "Range";
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ProTraderPage() {
  const [refreshMs, setRefreshMs] = useState(5000);
  const [selected, setSelected] = useState<StrategyKey | null>(null);
  const [triggers, setTriggers] = useState<TriggerEvent[]>([]);
  const [notifEnabled, setNotifEnabled] = useState(false);

  // Sync toggle with the browser's already-granted permission on mount so the
  // button doesn't falsely read "Enable alerts" after a previous session.
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "granted") setNotifEnabled(true);
  }, []);

  const prevStatusRef = useRef<Record<string, Status> | null>(null);
  const prevFingerprintRef = useRef<Record<string, string>>({});

  const { data, isLoading, isFetching, error, dataUpdatedAt } = useQuery<MonitorSnapshot>({
    queryKey: ["strategy-monitor"],
    queryFn: () => api.strategy.monitor() as Promise<MonitorSnapshot>,
    refetchInterval: refreshMs || false,
    staleTime: 2000,
  });

  useEffect(() => {
    if (!data?.strategies) return;
    const prev = prevStatusRef.current;
    const fpPrev = prevFingerprintRef.current;
    const next: Record<string, Status> = {};
    const fpNext: Record<string, string> = {};
    const newTriggers: TriggerEvent[] = [];

    for (const s of data.strategies) {
      next[s.key] = s.status;
      fpNext[s.key] = s.fingerprint;
      const before = prev?.[s.key];
      const fpBefore = fpPrev[s.key];
      const becameReady = before && before !== "READY" && s.status === "READY";
      const becameArmed = before && before === "WAIT" && s.status === "ARMED";
      const newPickWhileReady =
        before === "READY" &&
        s.status === "READY" &&
        fpBefore &&
        fpBefore !== s.fingerprint;
      if (becameReady || becameArmed || newPickWhileReady) {
        newTriggers.push({
          id: `${s.key}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          at: new Date().toISOString(),
          strategy: s.key,
          name: s.name,
          from: before ?? "WAIT",
          to: s.status,
          headline: s.headline,
        });
      }
    }

    prevStatusRef.current = next;
    prevFingerprintRef.current = fpNext;

    if (newTriggers.length) {
      setTriggers((list) => [...newTriggers, ...list].slice(0, 25));
      if (notifEnabled && typeof window !== "undefined" && "Notification" in window) {
        for (const t of newTriggers) {
          try {
            new Notification(`${t.name}: ${t.to}`, {
              body: t.headline,
              tag: `pro-trader-${t.strategy}`,
            });
          } catch {
            // noop
          }
        }
      }
    }
  }, [data?.generatedAt, data?.strategies, notifEnabled]);

  const ctx = data?.marketContext;
  const cards = data?.strategies ?? [];
  const selectedCard = useMemo(
    () => (selected ? cards.find((c) => c.key === selected) ?? null : null),
    [selected, cards],
  );

  const askNotifs = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "granted") {
      setNotifEnabled(true);
      return;
    }
    const res = await Notification.requestPermission();
    setNotifEnabled(res === "granted");
  };

  return (
    <div className="mx-auto min-h-screen max-w-[1500px] px-4 pb-24 pt-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500">
            NIFTY F&amp;O · Rule-based desk
          </p>
          <h1 className="mt-1 flex items-center gap-3 text-3xl font-bold tracking-tight text-white">
            Pro Trader
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                isFetching
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-slate-700 bg-slate-800/60 text-slate-400"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isFetching ? "animate-pulse bg-emerald-400" : "bg-slate-500"
                }`}
              />
              {isFetching ? "Live" : "Idle"}
            </span>
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Eight curated strategies monitored continuously against every proven
            technical (EMA 9/21, RSI, MACD, VWAP, SuperTrend, Bollinger,
            Stochastic, ROC, volume) plus full option-chain context (PCR, OI
            walls, ΔOI flow, max pain, IV %). Cards show{" "}
            <span className="text-emerald-300">READY</span> when the core edge
            is aligned; any card with a live chain pick can be entered directly
            — a review modal surfaces any weak checks first.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={askNotifs}
            className={`rounded-lg border px-3 py-2 text-xs font-medium transition ${
              notifEnabled
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500"
            }`}
            title="Get a browser notification when a strategy turns READY"
          >
            {notifEnabled ? "● Alerts on" : "○ Enable alerts"}
          </button>
          <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900/70 p-0.5">
            <span className="px-2 text-[11px] uppercase tracking-wide text-slate-500">
              Refresh
            </span>
            {REFRESH_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setRefreshMs(opt.value)}
                className={`rounded-md px-2 py-1 text-xs font-medium transition ${
                  refreshMs === opt.value
                    ? "bg-violet-600 text-white shadow"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {error && (
        <div className="mb-5 rounded-xl border border-rose-900 bg-rose-950/40 p-4 text-sm text-rose-200">
          Failed to load monitor: {(error as Error)?.message || "unknown error"}
        </div>
      )}
      {data?.error && (
        <div className="mb-5 rounded-xl border border-amber-900 bg-amber-950/30 p-4 text-sm text-amber-200">
          {data.error}
        </div>
      )}

      {ctx && <MarketTape ctx={ctx} generatedAt={data?.generatedAt ?? null} />}
      {ctx && <TechnicalsStrip ctx={ctx} />}

      {data?.counts && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
          <StatusPill status="READY" count={data.counts.ready} />
          <StatusPill status="ARMED" count={data.counts.armed} />
          <StatusPill status="WAIT" count={data.counts.wait} />
          <StatusPill status="AVOID" count={data.counts.avoid} />
          <span className="ml-auto text-[11px] text-slate-500">
            Last update{" "}
            {dataUpdatedAt
              ? formatTime(new Date(dataUpdatedAt).toISOString())
              : "—"}
          </span>
        </div>
      )}

      {isLoading ? (
        <StripSkeleton />
      ) : (
        <section
          aria-label="Strategy monitor"
          className="mb-8 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-4"
        >
          {cards.map((card) => (
            <StrategyCard
              key={card.key}
              card={card}
              onInspect={() => setSelected(card.key)}
            />
          ))}
        </section>
      )}

      <section className="mb-8 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
              Trigger feed
            </h2>
            <span className="text-[11px] text-slate-500">
              Most recent state changes · last 25
            </span>
          </div>
          {triggers.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              No triggers yet. A trigger fires when a strategy transitions into{" "}
              <span className="text-amber-300">ARMED</span> or{" "}
              <span className="text-emerald-300">READY</span>.
            </p>
          ) : (
            <ul className="divide-y divide-slate-800/60">
              {triggers.map((t) => (
                <li
                  key={t.id}
                  className="flex min-w-0 items-center gap-3 py-2 text-sm"
                >
                  <span className="w-16 flex-none font-mono text-[11px] text-slate-500">
                    {formatTime(t.at)}
                  </span>
                  <span className="flex h-5 flex-none items-center rounded border border-slate-700 bg-slate-800 px-1.5 text-[10px] font-semibold text-slate-300">
                    {t.from} → {t.to}
                  </span>
                  <span className="flex-none font-medium text-slate-200">
                    {t.name}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate text-xs text-slate-400"
                    title={t.headline}
                  >
                    {t.headline}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelected(t.strategy)}
                    className="flex-none text-[11px] text-violet-300 hover:text-violet-200"
                  >
                    Inspect
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">
            Rule framework
          </h2>
          <ul className="space-y-2 text-xs text-slate-400">
            <li>
              <span className="text-slate-200">Trend:</span> EMA 9/21, SuperTrend,
              Bollinger expansion / squeeze, live regime classifier.
            </li>
            <li>
              <span className="text-slate-200">Momentum:</span> RSI, MACD
              histogram, Stochastic, 5-bar ROC, VWAP position.
            </li>
            <li>
              <span className="text-slate-200">Volatility:</span> IV percentile,
              VIX band, Bollinger width.
            </li>
            <li>
              <span className="text-slate-200">Option chain:</span> PCR(OI), OI
              walls (max CE / PE), ΔOI flow, max pain vs spot, IV skew.
            </li>
            <li>
              <span className="text-slate-200">Structure:</span> DTE band, spot
              vs support/resistance/pivot.
            </li>
            <li>
              <span className="text-slate-200">Volume:</span> last-bar spike,
              candle direction.
            </li>
            <li className="pt-2 text-[11px] text-slate-500">
              <span className="text-emerald-300">READY</span> = every{" "}
              <span className="text-amber-300">critical</span> rule passes AND
              weighted match ≥ 70%.{" "}
              <span className="text-amber-300">ARMED</span> ≥ 55%.
            </li>
            <li className="text-[11px] text-slate-500">
              You can always <span className="text-amber-300">Enter anyway</span>{" "}
              — a confirmation modal shows every failing check first.
            </li>
          </ul>
        </div>
      </section>

      {selectedCard && (
        <StrategyDetailModal
          card={selectedCard}
          ctx={ctx ?? null}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

// ─── Market tape ────────────────────────────────────────────────────────────

function MarketTape({
  ctx,
  generatedAt,
}: {
  ctx: MonitorSnapshot["marketContext"];
  generatedAt: string | null;
}) {
  const up = ctx.spotChangePct >= 0;
  return (
    <section
      aria-label="Market tape"
      className="mb-3 overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900"
    >
      <div className="grid grid-cols-2 divide-x divide-slate-800 sm:grid-cols-4 lg:grid-cols-8">
        <TapeCell label="NIFTY" value={ctx.spot.toFixed(0)} accent="white" />
        <TapeCell
          label="Change"
          value={`${up ? "+" : ""}${ctx.spotChangePct.toFixed(2)}%`}
          accent={up ? "green" : "red"}
        />
        <TapeCell label="VIX" value={ctx.vix.toFixed(1)} />
        <TapeCell label="PCR" value={ctx.pcr.toFixed(2)} />
        <TapeCell
          label="Trend"
          value={`${formatTrend(ctx.trend)} · ${ctx.trendStrength}`}
        />
        <TapeCell label="IV %ile" value={`${ctx.ivPercentile}`} />
        <TapeCell
          label="ATM / DTE"
          value={`${ctx.atmStrike} · ${ctx.daysToExpiry}d`}
        />
        <TapeCell
          label="Max pain / σ"
          value={`${ctx.maxPain || "—"} · ±${ctx.expectedMovePts || 0}pt`}
        />
      </div>
      {generatedAt && (
        <div className="border-t border-slate-800 px-4 py-1.5 text-[10px] uppercase tracking-wider text-slate-600">
          Snapshot {formatTime(generatedAt)} · expiry {ctx.expiry} · PE wall{" "}
          {ctx.maxPutOI.strike} / CE wall {ctx.maxCallOI.strike}
        </div>
      )}
    </section>
  );
}

function TapeCell({
  label,
  value,
  accent = "default",
}: {
  label: string;
  value: string;
  accent?: "white" | "green" | "red" | "default";
}) {
  const color =
    accent === "white"
      ? "text-white"
      : accent === "green"
        ? "text-emerald-400"
        : accent === "red"
          ? "text-rose-400"
          : "text-slate-200";
  return (
    <div className="px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p className={`mt-1 font-mono text-lg font-semibold tabular-nums ${color}`}>
        {value}
      </p>
    </div>
  );
}

// ─── Technicals strip ───────────────────────────────────────────────────────

function TechnicalsStrip({ ctx }: { ctx: MonitorSnapshot["marketContext"] }) {
  const items: { label: string; value: string; tone?: "up" | "down" | "neutral" }[] = [
    {
      label: "RSI",
      value: ctx.rsi.toFixed(0),
      tone: ctx.rsi >= 55 ? "up" : ctx.rsi <= 45 ? "down" : "neutral",
    },
    {
      label: "EMA 9/21",
      value:
        ctx.emaCrossover === "BULLISH"
          ? "↑"
          : ctx.emaCrossover === "BEARISH"
            ? "↓"
            : "—",
      tone:
        ctx.emaCrossover === "BULLISH"
          ? "up"
          : ctx.emaCrossover === "BEARISH"
            ? "down"
            : "neutral",
    },
    {
      label: "SuperTrend",
      value: ctx.superTrendSignal,
      tone: ctx.superTrendSignal === "BUY" ? "up" : "down",
    },
    {
      label: "VWAP",
      value: ctx.priceVsVwap,
      tone:
        ctx.priceVsVwap === "ABOVE"
          ? "up"
          : ctx.priceVsVwap === "BELOW"
            ? "down"
            : "neutral",
    },
    {
      label: "MACD",
      value: ctx.macdBias ?? "—",
      tone:
        ctx.macdBias === "BULLISH"
          ? "up"
          : ctx.macdBias === "BEARISH"
            ? "down"
            : "neutral",
    },
    {
      label: "BB pos",
      value: ctx.bollingerPosition ? ctx.bollingerPosition.replace("_", " ") : "—",
      tone: "neutral",
    },
    {
      label: "BB width",
      value: ctx.bollingerWidthPct != null ? `${ctx.bollingerWidthPct}%` : "—",
      tone: "neutral",
    },
    {
      label: "Stoch",
      value: ctx.stochasticZone ?? "—",
      tone:
        ctx.stochasticZone === "OVERSOLD"
          ? "up"
          : ctx.stochasticZone === "OVERBOUGHT"
            ? "down"
            : "neutral",
    },
  ];
  return (
    <section
      aria-label="Technicals"
      className="mb-4 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/40"
    >
      <div className="flex min-w-max divide-x divide-slate-800/60">
        {items.map((it) => (
          <div key={it.label} className="flex flex-col gap-0.5 px-4 py-2">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">
              {it.label}
            </span>
            <span
              className={`font-mono text-sm font-semibold ${
                it.tone === "up"
                  ? "text-emerald-300"
                  : it.tone === "down"
                    ? "text-rose-300"
                    : "text-slate-200"
              }`}
            >
              {it.value}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Status pills ───────────────────────────────────────────────────────────

function StatusPill({ status, count }: { status: Status; count: number }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${s.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
      <span className="font-mono text-[11px] opacity-80">{count}</span>
    </span>
  );
}

// ─── Strategy card ──────────────────────────────────────────────────────────

function StrategyCard({
  card,
  onInspect,
}: {
  card: StrategyCard;
  onInspect: () => void;
}) {
  const s = STATUS_STYLE[card.status];
  return (
    <article
      className={`flex h-full flex-col overflow-hidden rounded-2xl border bg-slate-900/60 transition hover:-translate-y-0.5 hover:shadow-lg ${s.ring} ${
        card.status === "READY" ? "ring-1" : ""
      }`}
    >
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/60 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <span aria-hidden>{card.icon}</span>
          <span className="truncate">{card.name}</span>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${s.badge}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
          {s.label}
        </span>
      </div>

      <div className="px-3 pt-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">
            Rule match
          </span>
          <span className="font-mono text-sm font-semibold text-slate-200">
            {card.matchPct}%
          </span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div
            className={`h-full rounded-full transition-all ${s.bar}`}
            style={{ width: `${Math.max(6, card.matchPct)}%` }}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1 px-3 pt-2 text-[10px]">
        <span
          className={`rounded-full border px-1.5 py-0.5 ${
            card.bias === "CREDIT"
              ? "border-emerald-800/60 bg-emerald-900/20 text-emerald-300"
              : "border-sky-800/60 bg-sky-900/20 text-sky-300"
          }`}
        >
          {card.bias}
        </span>
        <span className="rounded-full border border-slate-700 bg-slate-800/70 px-1.5 py-0.5 text-slate-400">
          {card.legs} leg{card.legs > 1 ? "s" : ""}
        </span>
        <span
          className={`rounded-full border px-1.5 py-0.5 ${
            card.riskProfile === "LIMITED"
              ? "border-emerald-800/60 bg-emerald-900/20 text-emerald-300"
              : "border-rose-800/60 bg-rose-900/20 text-rose-300"
          }`}
        >
          Risk {card.riskProfile === "LIMITED" ? "capped" : "unlimited"}
        </span>
      </div>

      <p className="mt-2 line-clamp-2 px-3 text-xs leading-snug text-slate-300">
        {card.headline}
      </p>

      {/* Group mini-bars — the compact "all technicals" signal */}
      <div className="mt-3 grid grid-cols-3 gap-1.5 px-3">
        {card.groups.map((g) => (
          <GroupChip key={g.group} g={g} />
        ))}
      </div>

      {/* Pick */}
      <div className="mt-auto px-3 pb-3 pt-3">
        {card.pick ? (
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-2.5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">
                Pick
              </span>
              <span
                className={`font-mono text-xs font-semibold ${
                  card.pick.netCredit >= 0 ? "text-emerald-300" : "text-rose-300"
                }`}
              >
                {card.pick.netCredit >= 0 ? "Credit " : "Debit "}
                {formatINR(Math.abs(card.pick.netCredit) * 65)}
              </span>
            </div>
            <ul className="space-y-0.5 font-mono text-[11px] text-slate-300">
              {card.pick.legs.slice(0, 4).map((leg, i) => {
                const hasScrip = typeof leg.scripCode === "number";
                return (
                  <li key={i} className="flex items-center gap-1">
                    <span
                      className={`inline-block w-8 text-[10px] font-bold ${
                        leg.action === "SELL"
                          ? "text-rose-300"
                          : "text-emerald-300"
                      }`}
                    >
                      {leg.action}
                    </span>
                    <span className="text-slate-400">
                      {leg.strike} {leg.optionType}
                    </span>
                    {!hasScrip && (
                      <span
                        className="rounded bg-amber-500/15 px-1 text-[9px] font-semibold text-amber-300"
                        title="Broker scrip missing for this strike"
                      >
                        no scrip
                      </span>
                    )}
                    <span className="ml-auto tabular-nums text-slate-500">
                      ₹{leg.premium.toFixed(1)}
                    </span>
                  </li>
                );
              })}
            </ul>
            <div className="mt-2 grid grid-cols-2 gap-1.5 border-t border-slate-800 pt-2 text-[10px] text-slate-400">
              <span>
                Max P{" "}
                <span className="font-mono text-emerald-300">
                  {formatINR(card.pick.maxProfit)}
                </span>
              </span>
              <span>
                Max L{" "}
                <span className="font-mono text-rose-300">
                  {formatINR(card.pick.maxLoss)}
                </span>
              </span>
              <span className="col-span-2">
                BE{" "}
                <span className="font-mono text-slate-200">
                  {card.pick.breakeven.map((b) => b.toFixed(0)).join(" / ") || "—"}
                </span>
              </span>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-800 bg-slate-950/30 p-3 text-center text-[11px] text-slate-500">
            Chain pick unavailable for current setup
          </div>
        )}

        <div className="mt-2 flex items-center gap-2">
          <EnterButton card={card} />
          <button
            type="button"
            onClick={onInspect}
            className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-[11px] font-medium text-slate-300 transition hover:border-slate-500 hover:text-white"
            title="Inspect all rules & exit framework"
          >
            Rules
          </button>
        </div>
      </div>
    </article>
  );
}

/** Short tags for compact chips — better than arbitrary 5-char slicing. */
const GROUP_SHORT: Record<RuleGroup, string> = {
  trend: "Trend",
  momentum: "Mom",
  volatility: "Vol",
  option_chain: "Chain",
  structure: "Struct",
  volume: "Part",
};

function GroupChip({ g }: { g: MonitorGroup }) {
  const pct = g.weightTotal > 0 ? Math.round((g.weightPassed / g.weightTotal) * 100) : 0;
  const tone =
    pct >= 80
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
      : pct >= 50
        ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
        : "border-rose-500/30 bg-rose-500/5 text-rose-200";
  return (
    <div
      className={`flex items-center justify-between gap-1 rounded-md border px-1.5 py-1 text-[10px] ${tone}`}
      title={`${GROUP_LABELS[g.group]} · ${g.passed}/${g.total} rules passed (${pct}% weighted)`}
    >
      <span className="flex min-w-0 items-center gap-1">
        <span aria-hidden>{GROUP_ICONS[g.group]}</span>
        <span className="truncate font-medium">{GROUP_SHORT[g.group]}</span>
      </span>
      <span className="font-mono font-semibold tabular-nums">
        {g.passed}/{g.total}
      </span>
    </div>
  );
}

/**
 * EnterButton — status-aware with three usable tiers:
 *   READY  → green, direct confirm + place
 *   ARMED  → amber, "Enter anyway" with modal listing what's still weak
 *   WAIT   → amber outline, same flow (user sees exactly what's missing)
 *   AVOID  → red outline "Force enter"; requires the modal and is flagged risky
 *
 * The only hard disables are:
 *   - no live pick from the chain (can't construct legs)
 *   - any leg missing scripCode (broker order can't be placed)
 *
 * Disabled state always shows a one-line reason below the button so the
 * trader never has to guess why nothing's happening.
 */
function EnterButton({ card }: { card: StrategyCard }) {
  const [placeState, setPlaceState] = useState<"idle" | "ok" | "err">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const missingScrip = card.pick
    ? card.pick.legs.filter((l) => typeof l.scripCode !== "number")
    : [];
  const hardDisabled = !card.pick || missingScrip.length > 0;
  const missingDetail =
    missingScrip
      .map((l) => `${l.action} ${l.strike}${l.optionType}`)
      .join(", ") || "";
  const disabledReason: string | null = !card.pick
    ? "Chain pick unavailable — waiting for live option chain data"
    : missingScrip.length > 0
      ? `Broker scrip missing for ${missingScrip.length} leg${
          missingScrip.length > 1 ? "s" : ""
        } (${missingDetail}) — try another strike or refresh chain`
      : null;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!card.pick) throw new Error("No pick available");
      return api.trading.executeScan(
        card.pick.legs.map((l) => ({
          action: l.action,
          optionType: l.optionType,
          strike: l.strike,
          premium: l.premium,
          scripCode: l.scripCode,
          greeks: { iv: l.iv },
          oi: l.oi,
        })),
        undefined,
        {
          tradeType: card.key,
          direction: card.pick.direction,
          edge: card.headline,
          rationale: card.rules.filter((r) => r.passed).map((r) => r.detail),
          metrics: {
            netCredit: card.pick.netCredit,
            maxProfit: card.pick.maxProfit,
            maxLoss: card.pick.maxLoss,
            marginRequired: card.pick.marginEstimate,
            breakeven: card.pick.breakeven,
          },
        },
        null,
      );
    },
    onSuccess: (res) => {
      if (res.allOk) {
        setPlaceState("ok");
        setMessage("Orders placed");
      } else {
        setPlaceState("err");
        const first = res.results.find((r) => !r.ok);
        setMessage(first?.error ?? "Some legs failed");
      }
      setTimeout(() => setPlaceState("idle"), 4000);
    },
    onError: (e: any) => {
      setPlaceState("err");
      setMessage(e?.message ?? "Order failed");
      setTimeout(() => setPlaceState("idle"), 4000);
    },
  });

  const onClick = (e: React.MouseEvent) => {
    // Stop bubbling so clicking Enter inside the detail modal doesn't also
    // trigger the detail modal's backdrop-close handler.
    e.stopPropagation();
    if (hardDisabled) return;
    // Every status uses the styled confirmation modal — consistent UX, and
    // READY gets a positive confirmation banner instead of a native alert.
    setShowConfirm(true);
  };

  // Button visual
  const label = mutation.isPending
    ? "Placing…"
    : placeState === "ok"
      ? "✓ Placed"
      : placeState === "err"
        ? "Retry"
        : card.status === "READY"
          ? "Enter trade"
          : card.status === "ARMED"
            ? "Enter anyway"
            : card.status === "WAIT"
              ? "Enter anyway"
              : "Force enter";

  const btnClass = hardDisabled
    ? "cursor-not-allowed border border-slate-800 bg-slate-900 text-slate-600"
    : placeState === "ok"
      ? "bg-emerald-500 text-white"
      : placeState === "err"
        ? "bg-rose-600 text-white"
        : card.status === "READY"
          ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
          : card.status === "ARMED"
            ? "bg-amber-500 text-slate-950 hover:bg-amber-400"
            : card.status === "WAIT"
              ? "border border-amber-500/60 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
              : "border border-rose-500/60 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20";

  return (
    <div className="flex-1">
      <button
        type="button"
        disabled={hardDisabled || mutation.isPending}
        onClick={onClick}
        className={`w-full rounded-lg px-2 py-1.5 text-[12px] font-semibold transition ${btnClass}`}
        title={
          hardDisabled
            ? disabledReason ?? "Disabled"
            : card.status === "READY"
              ? "All critical rules passing — place broker orders for every leg"
              : "Setup isn't fully aligned — confirmation modal will show what's still weak"
        }
      >
        {label}
      </button>

      {disabledReason && (
        <p
          className="mt-1 truncate text-[10px] text-amber-300"
          title={disabledReason}
        >
          {disabledReason}
        </p>
      )}
      {!disabledReason && card.status !== "READY" && placeState === "idle" && (
        <p className="mt-1 truncate text-[10px] text-slate-500">
          {card.status === "ARMED"
            ? "Close to ready — click to review & enter"
            : card.status === "WAIT"
              ? "Still aligning — click to review weak checks"
              : "Edge is negative — force enter only if you accept it"}
        </p>
      )}
      {message && (
        <p
          className={`mt-1 truncate text-[10px] ${
            placeState === "err" ? "text-rose-300" : "text-emerald-300"
          }`}
          title={message}
        >
          {message}
        </p>
      )}

      {showConfirm && card.pick && (
        <SoftEnterConfirm
          card={card}
          onCancel={() => setShowConfirm(false)}
          onConfirm={() => {
            setShowConfirm(false);
            mutation.mutate();
          }}
        />
      )}
    </div>
  );
}

/**
 * Unified entry-confirmation modal used for every status (READY → AVOID).
 *
 * READY shows a positive green banner; ARMED / WAIT / AVOID show the failing
 * checks so the trader knows exactly what they're overriding.
 *
 * IMPORTANT: when nested inside the StrategyDetailModal, we must stop event
 * propagation on the backdrop + buttons — otherwise React synthetic events
 * bubble up to the parent modal's `onClick={onClose}` and close both.
 */
function SoftEnterConfirm({
  card,
  onCancel,
  onConfirm,
}: {
  card: StrategyCard;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const failing = card.rules.filter((r) => !r.passed);
  const criticals = failing.filter((r) => r.critical);
  const highWeight = failing.filter((r) => !r.critical && r.weight >= 2);

  const statusStyle = STATUS_STYLE[card.status];

  const handleBackdrop = (e: React.MouseEvent) => {
    e.stopPropagation();
    onCancel();
  };
  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    onCancel();
  };
  const handleConfirm = (e: React.MouseEvent) => {
    e.stopPropagation();
    onConfirm();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={handleBackdrop}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-800 px-5 py-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
              Review before entry
            </p>
            <h3 className="text-base font-semibold text-white">
              {card.icon} {card.name}
            </h3>
          </div>
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusStyle.badge}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${statusStyle.dot}`} />
            {statusStyle.label} · {card.matchPct}%
          </span>
        </header>

        <section className="space-y-3 px-5 py-4 text-sm">
          {card.status === "READY" && (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-200">
              All critical rules are aligned and weighted match is{" "}
              {card.matchPct}%. You&rsquo;re clear to fire the order.
            </div>
          )}
          {card.status === "AVOID" && (
            <div className="rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
              <strong>Warning:</strong> the rule engine rates this setup as
              AVOID. Forcing an entry here means the expected edge is either
              absent or actively negative. Only proceed if you have a specific
              reason the model can&rsquo;t see.
            </div>
          )}
          {card.status === "WAIT" && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
              Fewer than 55% of weighted rules are aligning — entering now
              means several checks haven&rsquo;t fired yet.
            </div>
          )}
          {card.status === "ARMED" && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200">
              Setup is close to READY (match ≥ 55%) but a few weighted checks
              are still missing. Confirm you&rsquo;re happy to proceed.
            </div>
          )}

          {criticals.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-300">
                Critical rules failing ({criticals.length})
              </p>
              <ul className="mt-1 space-y-1">
                {criticals.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/5 p-2 text-[12px] text-rose-100"
                  >
                    <span className="mt-0.5">✕</span>
                    <div>
                      <p className="font-medium">{r.label}</p>
                      <p className="text-[11px] text-rose-300/80">{r.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {highWeight.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Weighted rules still off ({highWeight.length})
              </p>
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
                {highWeight.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-start gap-2 text-[12px] text-slate-300"
                  >
                    <span className="mt-0.5 text-slate-500">·</span>
                    <span>
                      <span className="text-slate-200">{r.label}</span>{" "}
                      <span className="text-slate-500">— {r.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {card.pick && (
            <div className="rounded-md border border-slate-800 bg-slate-900/60 p-3 text-[12px]">
              <p className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
                You will place
              </p>
              <ul className="space-y-0.5 font-mono text-slate-300">
                {card.pick.legs.map((l, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span
                      className={`w-10 text-[10px] font-bold ${
                        l.action === "SELL"
                          ? "text-rose-300"
                          : "text-emerald-300"
                      }`}
                    >
                      {l.action}
                    </span>
                    <span>
                      {l.strike} {l.optionType}
                    </span>
                    <span className="ml-auto text-slate-500">
                      @ ₹{l.premium.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 grid grid-cols-3 gap-2 border-t border-slate-800 pt-2 text-[11px]">
                <span className="text-slate-400">
                  Max P{" "}
                  <span className="font-mono text-emerald-300">
                    {formatINR(card.pick.maxProfit)}
                  </span>
                </span>
                <span className="text-slate-400">
                  Max L{" "}
                  <span className="font-mono text-rose-300">
                    {formatINR(card.pick.maxLoss)}
                  </span>
                </span>
                <span className="text-slate-400">
                  Margin{" "}
                  <span className="font-mono text-slate-200">
                    {formatINR(card.pick.marginEstimate)}
                  </span>
                </span>
              </div>
            </div>
          )}
        </section>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-800 bg-slate-950 px-5 py-3">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              card.status === "READY"
                ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                : card.status === "AVOID"
                  ? "bg-rose-600 text-white hover:bg-rose-500"
                  : "bg-amber-500 text-slate-950 hover:bg-amber-400"
            }`}
          >
            {card.status === "READY"
              ? `Place ${card.pick?.legs.length ?? 0}-leg order`
              : card.status === "AVOID"
                ? "Force enter anyway"
                : `Place ${card.pick?.legs.length ?? 0}-leg order`}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ─── Detail modal ───────────────────────────────────────────────────────────

function StrategyDetailModal({
  card,
  ctx,
  onClose,
}: {
  card: StrategyCard;
  ctx: MonitorSnapshot["marketContext"] | null;
  onClose: () => void;
}) {
  const rulesByGroup: Record<RuleGroup, MonitorRule[]> = {
    trend: [],
    momentum: [],
    volatility: [],
    option_chain: [],
    structure: [],
    volume: [],
  };
  for (const r of card.rules) rulesByGroup[r.group].push(r);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-slate-800 bg-slate-950/95 px-5 py-3 backdrop-blur">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
              Strategy detail
            </p>
            <h3 className="truncate text-lg font-bold text-white">
              {card.icon} {card.name}
            </h3>
            <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-400">
              {card.summary}
            </p>
          </div>
          <div className="flex flex-none items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_STYLE[card.status].badge}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${STATUS_STYLE[card.status].dot}`} />
              {STATUS_STYLE[card.status].label} · {card.matchPct}%
            </span>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </header>

        <section className="p-5">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Rule matrix — {card.rules.filter((r) => r.passed).length} of{" "}
            {card.rules.length} passing
          </h4>
          <div className="space-y-3">
            {(Object.keys(rulesByGroup) as RuleGroup[])
              .filter((g) => rulesByGroup[g].length > 0)
              .map((g) => (
                <div key={g} className="rounded-lg border border-slate-800 bg-slate-900/40">
                  <div className="flex items-center justify-between border-b border-slate-800/70 px-3 py-1.5 text-[11px] uppercase tracking-wider text-slate-400">
                    <span>
                      {GROUP_ICONS[g]} {GROUP_LABELS[g]}
                    </span>
                    <span className="font-mono text-slate-500">
                      {rulesByGroup[g].filter((r) => r.passed).length}/
                      {rulesByGroup[g].length}
                    </span>
                  </div>
                  <ul className="divide-y divide-slate-800/60">
                    {rulesByGroup[g].map((r) => (
                      <li key={r.id} className="flex items-start gap-2 px-3 py-2 text-sm">
                        <span
                          className={`mt-0.5 inline-flex h-4 w-4 flex-none items-center justify-center rounded-full text-[11px] ${
                            r.passed
                              ? "bg-emerald-500/20 text-emerald-300"
                              : "bg-rose-500/20 text-rose-300"
                          }`}
                        >
                          {r.passed ? "✓" : "✕"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2 font-medium text-slate-200">
                            <span>{r.label}</span>
                            {r.critical && (
                              <span
                                className="rounded bg-amber-500/15 px-1 text-[9px] uppercase tracking-wider text-amber-300"
                                title="Must pass for READY"
                              >
                                critical
                              </span>
                            )}
                            <span className="rounded bg-slate-800 px-1 text-[9px] text-slate-400">
                              w{r.weight}
                            </span>
                          </p>
                          <p className="text-xs text-slate-400">{r.detail}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        </section>

        {card.pick && (
          <section className="border-t border-slate-800 p-5">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Live strike pick
            </h4>
            <div className="overflow-hidden rounded-lg border border-slate-800">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-900/80 text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Action</th>
                    <th className="px-3 py-2">Strike</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2 text-right">LTP</th>
                    <th className="px-3 py-2 text-right">IV</th>
                    <th className="px-3 py-2 text-right">OI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 font-mono text-[13px]">
                  {card.pick.legs.map((l, i) => {
                    const hasScrip = typeof l.scripCode === "number";
                    return (
                      <tr key={i} className={!hasScrip ? "bg-amber-500/5" : ""}>
                        <td
                          className={`px-3 py-2 font-semibold ${
                            l.action === "SELL"
                              ? "text-rose-300"
                              : "text-emerald-300"
                          }`}
                        >
                          {l.action}
                        </td>
                        <td className="px-3 py-2 tabular-nums">
                          {l.strike}
                          {!hasScrip && (
                            <span
                              className="ml-2 rounded bg-amber-500/15 px-1 text-[10px] font-semibold text-amber-300"
                              title="Broker scrip code missing for this strike — can't be ordered"
                            >
                              no scrip
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">{l.optionType}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {l.premium.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {l.iv.toFixed(1)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-400">
                          {(l.oi / 1000).toFixed(1)}k
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <KeyValue label="Net" value={formatINR(card.pick.netCredit * 65)} />
              <KeyValue label="Max P" value={formatINR(card.pick.maxProfit)} accent="green" />
              <KeyValue label="Max L" value={formatINR(card.pick.maxLoss)} accent="red" />
              <KeyValue
                label="Margin (est)"
                value={formatINR(card.pick.marginEstimate)}
              />
              <KeyValue
                label="Breakeven"
                value={
                  card.pick.breakeven.map((b) => b.toFixed(0)).join(" / ") || "—"
                }
              />
              {ctx && (
                <>
                  <KeyValue label="ATM" value={`${ctx.atmStrike}`} />
                  <KeyValue label="Spot" value={`${ctx.spot.toFixed(0)}`} />
                  <KeyValue label="DTE" value={`${ctx.daysToExpiry}`} />
                </>
              )}
            </div>
          </section>
        )}

        {card.pick && (
          <section className="border-t border-slate-800 bg-slate-900/40 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Place order
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {card.status === "READY"
                    ? "All critical rules passing — safe to enter"
                    : card.status === "ARMED"
                      ? "Close to READY — review weak checks in the modal"
                      : card.status === "WAIT"
                        ? "Partial alignment — review & confirm"
                        : "Edge negative — confirmation required"}
                </p>
              </div>
              <div className="w-56">
                <EnterButton card={card} />
              </div>
            </div>
          </section>
        )}

        <section className="border-t border-slate-800 p-5">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Exit framework
          </h4>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <ExitRow label="Stop loss" value={card.exitRules.stopLoss} />
            <ExitRow label="Target" value={card.exitRules.target} />
            <ExitRow label="Trail SL" value={card.exitRules.trailingSL} />
            <ExitRow label="Time exit" value={card.exitRules.timeExit} />
          </dl>
          <p className="mt-3 rounded-md border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-400">
            Exits are managed from{" "}
            <Link href="/positions" className="text-violet-300 hover:text-violet-200">
              /positions
            </Link>{" "}
            where P&amp;L and auto-exit rules are already tracked.
          </p>
        </section>
      </div>
    </div>
  );
}

function KeyValue({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "green" | "red";
}) {
  const color =
    accent === "green"
      ? "text-emerald-300"
      : accent === "red"
        ? "text-rose-300"
        : "text-slate-200";
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/40 p-2">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p className={`mt-0.5 font-mono text-sm font-semibold ${color}`}>{value}</p>
    </div>
  );
}

function ExitRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/40 p-3">
      <dt className="text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-slate-200">{value}</dd>
    </div>
  );
}

function StripSkeleton() {
  return (
    <div className="mb-8 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="flex h-[22rem] animate-pulse flex-col gap-2 rounded-2xl border border-slate-800 bg-slate-900/40 p-3"
        >
          <div className="h-4 w-2/3 rounded bg-slate-800" />
          <div className="h-2 w-full rounded bg-slate-800/70" />
          <div className="mt-1 flex gap-1">
            <div className="h-4 w-12 rounded-full bg-slate-800/70" />
            <div className="h-4 w-12 rounded-full bg-slate-800/70" />
            <div className="h-4 w-16 rounded-full bg-slate-800/70" />
          </div>
          <div className="mt-1 grid grid-cols-3 gap-1.5">
            {Array.from({ length: 6 }).map((__, j) => (
              <div key={j} className="h-5 rounded bg-slate-800/70" />
            ))}
          </div>
          <div className="mt-auto h-20 rounded bg-slate-800/60" />
          <div className="h-7 rounded bg-slate-800/70" />
        </div>
      ))}
    </div>
  );
}
