"use client";

/**
 * Pro Options Desk — NIFTY chain scan with seller-hedge structures, long legs for
 * defined risk, continuous refresh, and alignment vs technical + pro indicators.
 * Includes FII/DII (NSE) when the session feed is reachable.
 */

import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ─── Types (mirrors server) ─────────────────

interface ScanLeg {
  action: "BUY" | "SELL";
  optionType: "CE" | "PE";
  strike: number;
  premium: number;
  iv: number;
  delta: number;
  oi: number;
  changeInOi: number;
  volume: number;
  scripCode?: number;
}

interface ScanTrade {
  id: string;
  tradeType: string;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  legs: ScanLeg[];
  netCredit: number;
  maxProfit: number;
  maxLoss: number;
  breakeven: number[];
  marginRequired: number;
  winProbability: number;
  expectedValue: number;
  riskReward: number;
  kellyScore: number;
  score: number;
  edge: string;
  rationale: string[];
  warnings: string[];
  oiWall: string;
  thetaDecayPerDay: number;
  targetTime: string;
}

type ProStatus = "ACTIVE" | "STANDBY" | "AVOID" | "NO_TRADE";

interface ProSignal {
  status: ProStatus;
  alignmentPct: number;
  label: string;
  entryChecks: { id: string; label: string; passed: boolean; detail: string; critical: boolean }[];
  exitGuidance: { id: string; label: string; passed: boolean; detail: string; critical: boolean }[];
  playbook: {
    structure: string;
    incomeSummary: string;
    hedgeOrLongSummary: string;
    executionNote: string;
  };
}

interface OiLegRow {
  strike: number;
  oi: number;
  changeInOi: number;
  volume: number;
}

interface OiInsights {
  topCallByOi: OiLegRow[];
  topPutByOi: OiLegRow[];
  topCallByOiChange: OiLegRow[];
  topPutByOiChange: OiLegRow[];
  netCallOiChange: number;
  netPutOiChange: number;
  callFlow: string;
  putFlow: string;
  narrative: string;
}

interface ProIndicators {
  macd: { macd: number; signal: number; histogram: number; bias: string } | null;
  bollinger: { upper: number; middle: number; lower: number; percentB: number; widthPct: number; position: string } | null;
  stochastic: { k: number; d: number; zone: string } | null;
  chain: {
    maxPain: number;
    totalCallOI: number;
    totalPutOI: number;
    totalCallVol: number;
    totalPutVol: number;
    pcrOI: number;
    pcrVolume: number;
    ivSkewATM: number;
  } | null;
  oiInsights: OiInsights | null;
}

interface FiiDiiOut {
  dataAvailable: boolean;
  asOf?: string;
  message?: string;
  servedFromCache?: boolean;
  cacheNote?: string;
  rows?: { category: string; buyValue: number; sellValue: number; netValue: number }[];
}

interface ScanResult {
  bestTrade: ScanTrade | null;
  alternates: ScanTrade[];
  topCreditStrategies?: ScanTrade[];
  marketBias: "BULLISH" | "BEARISH" | "NEUTRAL";
  biasStrength: number;
  scanTimestamp: string;
  marketContext: {
    spot: number;
    spotChange?: number;
    spotChangePct?: number;
    vix: number;
    pcr: number;
    trend: string;
    trendStrength: number;
    ivPercentile: number;
    maxCallOI: { strike: number; oi: number };
    maxPutOI: { strike: number; oi: number };
    atmIV: number;
    atmStraddle: number;
    expectedMove: number;
    daysToExpiry: number;
  };
  professionalIndicators?: ProIndicators;
  fiiDii?: FiiDiiOut | null;
  proSignal?: ProSignal;
  tradingAlgo?: TradingAlgo;
  error?: string;
}

type AlgoAction = "ENTER" | "PREPARE" | "WAIT" | "STAND_DOWN" | "NO_SETUP";

interface TradingAlgo {
  suggestedAction: AlgoAction;
  entryHeadline: string;
  entryDetail: string;
  entryReadiness: number;
  fingerprint: string;
  isEntryWindow: boolean;
  exitPlan: {
    takeProfitRupees: number;
    takeProfitPctOfMaxProfit: number;
    softStopLossRupees: number;
    softStopPctOfMaxLoss: number;
    hardStopLossRupees: number;
    spotBufferPoints: number;
    breakevenLevels: string;
    timeExitRule: string;
    ivExitRule: string;
    checklists: { label: string; detail: string }[];
  } | null;
  alerts: {
    id: string;
    kind: string;
    level: "info" | "warning" | "critical";
    title: string;
    message: string;
    fireBrowser: boolean;
  }[];
}

interface HistoryEntry {
  time: string;
  tradeType: string;
  direction: string;
  edge: string;
  winProb: number;
  ev: number;
  score: number;
}

// ─── Constants ──────────────────────────────

const NIFTY_OPTION_LOT = 75;

const REFRESH_OPTIONS = [
  { label: "5s", value: 5000 },
  { label: "8s", value: 8000 },
  { label: "15s", value: 15000 },
  { label: "30s", value: 30000 },
  { label: "Off", value: 0 },
];

const BIAS_COLORS = {
  BULLISH: { bg: "bg-emerald-900/30", border: "border-emerald-600", text: "text-emerald-400", icon: "🟢" },
  BEARISH: { bg: "bg-rose-900/30", border: "border-rose-600", text: "text-rose-400", icon: "🔴" },
  NEUTRAL: { bg: "bg-blue-900/30", border: "border-blue-600", text: "text-blue-400", icon: "🔵" },
};

const TRADE_TYPE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  SELL_PE: { label: "Sell Put", icon: "🟢", color: "text-emerald-400" },
  SELL_CE: { label: "Sell Call", icon: "🔴", color: "text-rose-400" },
  BULL_PUT_SPREAD: { label: "Bull Put Spread", icon: "📈", color: "text-emerald-400" },
  BEAR_CALL_SPREAD: { label: "Bear Call Spread", icon: "📉", color: "text-rose-400" },
  SHORT_STRANGLE: { label: "Short Strangle", icon: "🔀", color: "text-blue-400" },
  IRON_CONDOR: { label: "Iron Condor", icon: "🦅", color: "text-blue-400" },
  BUY_CE: { label: "Buy Call", icon: "🚀", color: "text-emerald-400" },
  BUY_PE: { label: "Buy Put", icon: "💥", color: "text-rose-400" },
};

/** User-facing strategy bucket (credit / debit / neutral) */
const STRATEGY_FAMILY: Record<string, { bucket: string; description: string }> = {
  BULL_PUT_SPREAD: { bucket: "Credit spread", description: "Put credit spread (bullish)" },
  BEAR_CALL_SPREAD: { bucket: "Credit spread", description: "Call credit spread (bearish)" },
  IRON_CONDOR: { bucket: "Neutral — credit", description: "Iron condor" },
  SHORT_STRANGLE: { bucket: "Neutral — credit", description: "Short strangle" },
  SELL_PE: { bucket: "Short premium", description: "Sell put (naked / CSP style)" },
  SELL_CE: { bucket: "Short premium", description: "Sell call (naked)" },
  BUY_CE: { bucket: "Debit (long)", description: "Long call" },
  BUY_PE: { bucket: "Debit (long)", description: "Long put" },
};

function formatChartTrend(t: string): string {
  if (t === "trend-up") return "Uptrend";
  if (t === "trend-down") return "Downtrend";
  return "Sideways / range";
}

function getBiasNote(
  marketBias: string,
  trend: string,
  spotChangePct: number,
): string | null {
  if (trend === "trend-down" && marketBias === "BULLISH") {
    return "Chart is in a downtrend but the desk still tilts bullish on some inputs. Prefer smaller size and defined-risk credit.";
  }
  if (trend === "trend-up" && marketBias === "BEARISH") {
    return "Chart is in an uptrend but the desk tilts bearish on some inputs. Be careful shorting into strength.";
  }
  if (spotChangePct < -0.2 && marketBias === "BULLISH") {
    return "Spot is down today while bias is bullish — session is weak; any long-delta idea is more fragile.";
  }
  return null;
}

function StrategyFamilyRow({ tradeType }: { tradeType: string }) {
  const m = STRATEGY_FAMILY[tradeType] ?? { bucket: "Options", description: tradeType };
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-200">{m.bucket}</span>
      <span className="text-[11px] text-slate-500">{m.description}</span>
    </div>
  );
}

// ─── Component ──────────────────────────────

export default function AutoScannerPage() {
  const [refreshInterval, setRefreshInterval] = useState(8000);
  const [capital, setCapital] = useState(200000);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [scanCount, setScanCount] = useState(0);
  const lastTradeRef = useRef<string | null>(null);
  const algoNotifyRef = useRef<{ lastAction: string; lastBestId: string | null }>({
    lastAction: "",
    lastBestId: null,
  });

  const { data, isLoading, isFetching, error } = useQuery<ScanResult>({
    queryKey: ["auto-scan", capital],
    queryFn: () => api.strategy.autoScan(capital) as Promise<ScanResult>,
    refetchInterval: refreshInterval || false,
    staleTime: 4000,
  });

  // Track history when best trade changes
  useEffect(() => {
    if (!data?.bestTrade) return;
    const trade = data.bestTrade;
    if (trade.id === lastTradeRef.current) return;
    lastTradeRef.current = trade.id;
    setScanCount((c) => c + 1);
    setHistory((prev) => [
      {
        time: new Date().toLocaleTimeString("en-IN"),
        tradeType: trade.tradeType,
        direction: trade.direction,
        edge: trade.edge,
        winProb: trade.winProbability,
        ev: trade.expectedValue,
        score: trade.score,
      },
      ...prev.slice(0, 19), // keep last 20
    ]);
  }, [data?.bestTrade?.id]);

  // Browser alert when the desk first signals ENTER, or the top pick changes while still ENTER
  useEffect(() => {
    const algo = data?.tradingAlgo;
    const id = data?.bestTrade?.id ?? null;
    if (!algo || !data?.bestTrade || typeof window === "undefined" || !("Notification" in window)) return;
    if (algo.suggestedAction !== "ENTER") {
      algoNotifyRef.current = { lastAction: algo.suggestedAction, lastBestId: id };
      return;
    }
    if (Notification.permission !== "granted") return;
    const prev = algoNotifyRef.current;
    const firstEnter = prev.lastAction !== "ENTER";
    const newPick = id != null && prev.lastBestId !== id;
    if (firstEnter || newPick) {
      const tt = TRADE_TYPE_LABELS[data.bestTrade.tradeType]?.label ?? data.bestTrade.tradeType;
      new Notification("NIFTY Pro Desk — entry signal", {
        body: `${tt}: ${algo.entryHeadline}. Check exit ₹ targets on the page.`,
        tag: `autoscan-${id ?? "x"}`,
      });
    }
    algoNotifyRef.current = { lastAction: "ENTER", lastBestId: id };
  }, [data?.tradingAlgo, data?.bestTrade?.id, data?.bestTrade?.tradeType]);

  const ctx = data?.marketContext;
  const best = data?.bestTrade;
  const biasNote =
    data && ctx
      ? getBiasNote(data.marketBias, ctx.trend, ctx.spotChangePct ?? 0)
      : null;

  return (
    <div className="mx-auto min-h-screen max-w-6xl p-4 pb-16 sm:p-8">
      {/* Header */}
      <header className="mb-8 border-b border-slate-800/80 pb-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">NIFTY F&amp;O</p>
            <h1 className="mt-1 flex items-center gap-2 text-3xl font-bold tracking-tight text-white">
              Strategy scanner
              {isFetching && (
                <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" title="Updating" />
              )}
            </h1>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-slate-400">
              Spreads, strangles, condors, and long options — grouped as <span className="text-slate-200">credit</span>,{" "}
              <span className="text-slate-200">debit</span>, or <span className="text-slate-200">short premium</span>. Bias
              now weights <span className="text-slate-200">index trend</span> and <span className="text-slate-200">today’s
              spot change</span> so it matches bear markets better.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs text-slate-400">
              Capital
              <input
                type="number"
                value={capital}
                onChange={(e) => setCapital(Number(e.target.value) || 200000)}
                className="w-24 rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-right text-sm text-white"
                step={50000}
                min={50000}
              />
            </label>
            <div className="flex rounded-lg border border-slate-700 p-0.5">
              {REFRESH_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setRefreshInterval(opt.value)}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    refreshInterval === opt.value
                      ? "bg-violet-600 text-white"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <span className="text-xs text-slate-600">Refresh #{scanCount}</span>
          </div>
        </div>
      </header>

      {/* At-a-glance: index vs desk (fixes confusion: trend + spot now drive bias) */}
      {ctx && data && (
        <section className="mb-6 grid gap-4 md:grid-cols-3" aria-label="Market snapshot">
          <div className="rounded-2xl border border-slate-700/80 bg-gradient-to-b from-slate-900/80 to-slate-950 p-5 shadow-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">NIFTY spot</h2>
            <p className="mt-2 text-4xl font-bold tabular-nums text-white">{ctx.spot.toFixed(0)}</p>
            <p
              className={`mt-1 text-sm font-medium tabular-nums ${
                (ctx.spotChangePct ?? 0) >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {(ctx.spotChangePct ?? 0) >= 0 ? "+" : ""}
              {(ctx.spotChangePct ?? 0).toFixed(2)}% session
            </p>
            <p className="mt-4 text-sm text-slate-300">
              <span className="text-slate-500">Chart (daily):</span>{" "}
              <span className="font-semibold text-white">{formatChartTrend(ctx.trend)}</span>
              <span className="text-slate-500"> · strength {ctx.trendStrength}</span>
            </p>
          </div>
          <div
            className={`rounded-2xl border-2 p-5 shadow-sm ${
              BIAS_COLORS[data.marketBias].bg
            } ${BIAS_COLORS[data.marketBias].border}`}
          >
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Desk idea bias</h2>
            <p className={`mt-2 text-3xl font-bold ${BIAS_COLORS[data.marketBias].text}`}>{data.marketBias}</p>
            <p className="mt-1 text-sm text-slate-400">How strongly ideas lean this way: {data.biasStrength}%</p>
            <p className="mt-3 text-xs leading-relaxed text-slate-500">
              Built from: trend, today’s % move, EMA, SuperTrend, VWAP, RSI, PCR. Same “trend” as the left card is
              weighted heavily so bear days don’t show “bull” unless data supports it.
            </p>
            {biasNote && (
              <p className="mt-3 rounded-lg border border-amber-800/50 bg-amber-950/30 p-2 text-xs text-amber-100/90">
                {biasNote}
              </p>
            )}
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-black/20">
              <div
                className={`h-full rounded-full transition-all ${
                  data.marketBias === "BULLISH"
                    ? "bg-emerald-500"
                    : data.marketBias === "BEARISH"
                      ? "bg-rose-500"
                      : "bg-sky-500"
                }`}
                style={{ width: `${Math.max(8, data.biasStrength)}%` }}
              />
            </div>
          </div>
          <div className="rounded-2xl border border-slate-700/80 bg-slate-900/50 p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vol &amp; OI context</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">VIX</dt>
                <dd className="font-mono text-slate-200">{ctx.vix.toFixed(1)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">PCR</dt>
                <dd className="font-mono text-slate-200">{ctx.pcr.toFixed(2)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">ATM straddle</dt>
                <dd className="font-mono text-slate-200">₹{ctx.atmStraddle}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">1σ move (est.)</dt>
                <dd className="font-mono text-slate-200">±{ctx.expectedMove} pts</dd>
              </div>
              <div className="flex justify-between gap-2 border-t border-slate-800 pt-2">
                <dt className="text-slate-500">Max OI (PE / CE)</dt>
                <dd className="text-right text-[11px] text-slate-400">
                  {ctx.maxPutOI.strike} / {ctx.maxCallOI.strike}
                </dd>
              </div>
            </dl>
          </div>
        </section>
      )}

      {data?.proSignal && <ProSignalBanner signal={data.proSignal} />}

      {data?.tradingAlgo && (
        <TradingAlgoPanel
          algo={data.tradingAlgo}
          daysToExpiry={data.marketContext?.daysToExpiry ?? 0}
        />
      )}

      {/* Advanced: institutions + indicators — collapsible */}
      {(data?.fiiDii || data?.professionalIndicators) && (
        <details className="group mb-6 rounded-2xl border border-slate-800 bg-slate-950/40 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium text-slate-300 transition hover:bg-slate-800/50">
            <span className="inline-block text-slate-500 transition group-open:rotate-90">▶</span>
            <span className="text-slate-400">Advanced: FII / DII, MACD, Bollinger, stochastic, OI build-up</span>
          </summary>
          <div className="border-t border-slate-800/80 p-4 pt-2">
            {data.fiiDii && <FiiDiiPanel fii={data.fiiDii} />}
            {data.professionalIndicators && (
              <>
                <ProIndicatorsPanel spot={ctx?.spot ?? 0} ind={data.professionalIndicators} />
                {data.professionalIndicators.oiInsights && (
                  <OiBuildupPanel oi={data.professionalIndicators.oiInsights} />
                )}
              </>
            )}
          </div>
        </details>
      )}

      {/* ─── Loading State ───────────────────── */}
      {isLoading && (
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-yellow-500 border-t-transparent" />
            <p className="text-gray-400">Scanning NIFTY chain, credit spreads, strangles &amp; condors…</p>
          </div>
        </div>
      )}

      {/* ─── Error State ─────────────────────── */}
      {data?.error && !best && (
        <div className="rounded-lg border border-red-800 bg-red-900/20 p-6 text-center">
          <p className="text-red-400">⚠️ {data.error}</p>
        </div>
      )}

      {/* ─── No Trade Found ──────────────────── */}
      {data && !data.error && !best && !isLoading && (
        <div className="rounded-lg border border-yellow-800 bg-yellow-900/20 p-6 text-center">
          <p className="text-xl">🚫 No Positive-EV Trade Found</p>
          <p className="mt-2 text-sm text-gray-400">
            All scanned trades have negative expected value in current conditions.
            Market may be too volatile or premiums too thin.
          </p>
        </div>
      )}

      {/* ─── Playbook + entry/exit (same structure as server) ─ */}
      {data?.proSignal?.playbook && (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Structure &amp; legs</h3>
            <p className="text-sm text-slate-300">{data.proSignal.playbook.structure}</p>
            {best && (
            <div className="mt-3 space-y-2 text-xs">
              <div>
                <span className="text-rose-400/90">Short / credit: </span>
                <span className="font-mono text-slate-200">{data.proSignal.playbook.incomeSummary}</span>
              </div>
              <div>
                <span className="text-emerald-400/90">Long / hedge: </span>
                <span className="font-mono text-slate-200">{data.proSignal.playbook.hedgeOrLongSummary}</span>
              </div>
              <p className="text-slate-500">{data.proSignal.playbook.executionNote}</p>
            </div>
            )}
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Entry alignment</h3>
            <ul className="max-h-56 space-y-1.5 overflow-y-auto text-xs">
              {data.proSignal.entryChecks.map((c) => (
                <li key={c.id} className="flex gap-2">
                  <span className={c.passed ? "text-emerald-400" : "text-rose-400"}>{c.passed ? "✓" : "✗"}</span>
                  <span>
                    <span className="font-medium text-slate-300">{c.label}</span>
                    {c.critical && <span className="ml-1 text-amber-500">●</span>}
                    <span className="block text-slate-500">{c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4 lg:col-span-2">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">When to cut / scale (exit framework)</h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {data.proSignal.exitGuidance.map((c) => (
                <li key={c.id} className="flex gap-2 text-xs text-slate-400">
                  <span className="text-cyan-500">→</span>
                  <span><span className="font-medium text-slate-300">{c.label}:</span> {c.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ─── Top credit (selling) ideas — always from chain when available ─ */}
      {data?.topCreditStrategies && data.topCreditStrategies.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-white">Credit &amp; short-premium ideas</h2>
          <p className="mb-1 text-sm text-slate-400">Credit spreads, short strangle, iron condor — you receive net premium (subject to margin &amp; risk).</p>
          <p className="mb-4 text-xs text-slate-600">
            “Enter in broker” needs ScripCode on every leg. If missing, refresh data or place legs manually in 5paisa.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.topCreditStrategies.map((t) => (
              <CreditStrategyCard key={t.id} trade={t} lotQty={NIFTY_OPTION_LOT} />
            ))}
          </div>
        </div>
      )}

      {/* ─── Best Trade Card ─────────────────── */}
      {best && <BestTradeCard trade={best} capital={capital} lotQty={NIFTY_OPTION_LOT} />}

      {/* ─── Alternates ──────────────────────── */}
      {data?.alternates && data.alternates.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-1 text-lg font-semibold text-slate-200">Other ranked ideas</h2>
          <p className="mb-3 text-xs text-slate-500">Same scan; runner-up structures.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.alternates.map((trade) => (
              <AlternateCard key={trade.id} trade={trade} lotQty={NIFTY_OPTION_LOT} />
            ))}
          </div>
        </div>
      )}

      {/* ─── Signal History ──────────────────── */}
      {history.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-lg font-semibold text-gray-300">📜 Scan History</h2>
          <div className="max-h-64 overflow-auto rounded-lg border border-gray-800 bg-gray-900/60">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-900">
                <tr className="text-gray-500">
                  <th className="px-3 py-2 text-left">Time</th>
                  <th className="px-3 py-2 text-left">Trade</th>
                  <th className="px-3 py-2 text-left">Direction</th>
                  <th className="px-3 py-2 text-right">Win %</th>
                  <th className="px-3 py-2 text-right">EV ₹</th>
                  <th className="px-3 py-2 text-right">Score</th>
                  <th className="px-3 py-2 text-left">Edge</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => {
                  const tt = TRADE_TYPE_LABELS[h.tradeType] || { icon: "?", label: h.tradeType, color: "text-gray-400" };
                  return (
                    <tr key={i} className="border-t border-gray-800 hover:bg-gray-800/50">
                      <td className="px-3 py-1.5 text-gray-500">{h.time}</td>
                      <td className={`px-3 py-1.5 font-medium ${tt.color}`}>{tt.icon} {tt.label}</td>
                      <td className="px-3 py-1.5">
                        <span className={
                          h.direction === "BULLISH" ? "text-emerald-400" :
                          h.direction === "BEARISH" ? "text-rose-400" : "text-blue-400"
                        }>
                          {h.direction}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">{h.winProb}%</td>
                      <td className={`px-3 py-1.5 text-right font-mono ${h.ev >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {h.ev >= 0 ? "+" : ""}₹{h.ev.toLocaleString("en-IN")}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">{h.score}</td>
                      <td className="max-w-[200px] truncate px-3 py-1.5 text-xs text-gray-500">{h.edge}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Best Trade Card ────────────────────────

function BestTradeCard({ trade, capital, lotQty }: { trade: ScanTrade; capital: number; lotQty: number }) {
  const tt = TRADE_TYPE_LABELS[trade.tradeType] || { icon: "?", label: trade.tradeType, color: "text-gray-400" };
  const evPositive = trade.expectedValue >= 0;
  const target2Pct = capital * 0.02;
  const hitsTarget = trade.maxProfit >= target2Pct;
  const isCredit = trade.netCredit > 0;

  return (
    <div className="rounded-2xl border-2 border-violet-500/40 bg-gradient-to-br from-slate-900 via-slate-900 to-violet-950/30 p-6 shadow-lg shadow-violet-900/20">
      <StrategyFamilyRow tradeType={trade.tradeType} />
      {/* Header */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Top pick</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-2xl">{tt.icon}</span>
            <h2 className={`text-xl font-bold ${tt.color}`}>{tt.label}</h2>
            <span className={`rounded px-2 py-0.5 text-xs font-semibold ${
              trade.direction === "BULLISH" ? "bg-emerald-900/50 text-emerald-400" :
              trade.direction === "BEARISH" ? "bg-rose-900/50 text-rose-400" :
              "bg-blue-900/50 text-blue-400"
            }`}>
              {trade.direction} structure
            </span>
          </div>
          <p className="mt-0.5 text-[10px] text-slate-500">Structure bias (e.g. bull put = bullish structure) — not the same as index “desk bias” above.</p>
          <p className="mt-1 text-sm text-violet-200/90">{trade.edge}</p>
        </div>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <div className="text-right">
            <div className="text-3xl font-bold text-yellow-400">{trade.score}</div>
            <div className="text-xs text-gray-500">score</div>
          </div>
          {isCredit && (
            <span className="rounded bg-amber-900/50 px-2 py-0.5 text-center text-xs font-medium text-amber-300">
              Credit / selling
            </span>
          )}
          <EnterPositionButton trade={trade} lotQty={lotQty} label={`Enter in broker (1 lot × ${lotQty})`} />
        </div>
      </div>

      {/* Win Probability + EV + R:R — the 3 key metrics */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <MetricBox
          label="Win Probability"
          value={`${trade.winProbability}%`}
          color={trade.winProbability >= 70 ? "text-green-400" : trade.winProbability >= 55 ? "text-yellow-400" : "text-red-400"}
          sub={`Delta-derived`}
        />
        <MetricBox
          label="Expected Value"
          value={`${evPositive ? "+" : ""}₹${trade.expectedValue.toLocaleString("en-IN")}`}
          color={evPositive ? "text-green-400" : "text-red-400"}
          sub="per lot"
        />
        <MetricBox
          label="Risk : Reward"
          value={`1 : ${trade.riskReward.toFixed(1)}`}
          color={trade.riskReward >= 0.4 ? "text-blue-400" : "text-orange-400"}
          sub={`Max P: ₹${trade.maxProfit.toLocaleString("en-IN")}`}
        />
      </div>

      {/* Legs */}
      <div className="mb-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-400">TRADE LEGS</h3>
        <div className="space-y-1.5">
          {trade.legs.map((leg, i) => (
            <div key={i} className="flex items-center justify-between rounded bg-gray-800/80 px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${
                  leg.action === "SELL" ? "bg-red-900/60 text-red-400" : "bg-green-900/60 text-green-400"
                }`}>
                  {leg.action}
                </span>
                <span className="font-mono font-semibold text-white">{leg.strike} {leg.optionType}</span>
                {leg.scripCode != null && (
                  <span className="text-[10px] text-slate-500">scrip {leg.scripCode}</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
                <span>LTP: <span className="font-mono text-white">₹{leg.premium}</span></span>
                <span>IV: <span className="font-mono">{leg.iv.toFixed(1)}%</span></span>
                <span>Δ: <span className="font-mono">{leg.delta.toFixed(2)}</span></span>
                <span>OI: <span className="font-mono">{formatLakh(leg.oi)}</span></span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Financial summary */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <FinBox label="Net Credit" value={`₹${trade.netCredit}`} positive={trade.netCredit > 0} />
        <FinBox label="Max Profit" value={`₹${trade.maxProfit.toLocaleString("en-IN")}`} positive />
        <FinBox label="Max Loss" value={`₹${trade.maxLoss.toLocaleString("en-IN")}`} positive={false} />
        <FinBox label="Margin Req." value={`₹${trade.marginRequired.toLocaleString("en-IN")}`} />
      </div>

      {/* Breakeven + Target */}
      <div className="mb-4 flex flex-wrap gap-3 text-xs">
        <span className="rounded bg-gray-800 px-2 py-1 text-gray-400">
          🎯 Breakeven: {trade.breakeven.map((b) => b.toFixed(0)).join(" / ")}
        </span>
        <span className="rounded bg-gray-800 px-2 py-1 text-gray-400">
          ⏱️ Time: {trade.targetTime}
        </span>
        <span className="rounded bg-gray-800 px-2 py-1 text-gray-400">
          📉 θ Decay: ₹{trade.thetaDecayPerDay}/day
        </span>
        {hitsTarget && (
          <span className="rounded bg-yellow-900/50 px-2 py-1 font-semibold text-yellow-400">
            ✅ Hits 2% target (₹{target2Pct.toLocaleString("en-IN")})
          </span>
        )}
      </div>

      {/* OI Wall */}
      {trade.oiWall && (
        <div className="mb-3 rounded bg-gray-800/60 px-3 py-2 text-xs text-gray-400">
          🧱 <span className="font-semibold text-gray-300">OI Walls:</span> {trade.oiWall}
        </div>
      )}

      {/* Rationale */}
      {trade.rationale.length > 0 && (
        <div className="mb-3">
          <h3 className="mb-1 text-xs font-semibold text-gray-500">WHY THIS TRADE</h3>
          <ul className="space-y-0.5 text-xs text-gray-400">
            {trade.rationale.map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings */}
      {trade.warnings.length > 0 && (
        <div className="rounded border border-orange-800 bg-orange-900/20 px-3 py-2">
          {trade.warnings.map((w, i) => (
            <p key={i} className="text-xs text-orange-400">{w}</p>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Alternate Trade Card ───────────────────

function CreditStrategyCard({ trade, lotQty }: { trade: ScanTrade; lotQty: number }) {
  const tt = TRADE_TYPE_LABELS[trade.tradeType] || { icon: "?", label: trade.tradeType, color: "text-gray-400" };
  return (
    <div className="rounded-xl border border-amber-800/40 bg-amber-950/15 p-4 shadow-sm">
      <StrategyFamilyRow tradeType={trade.tradeType} />
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{tt.icon}</span>
          <span className={`font-semibold ${tt.color}`}>{tt.label}</span>
        </div>
        <span className="text-xs text-amber-200/80">+₹{trade.netCredit} cr.</span>
      </div>
      <div className="mb-2 space-y-0.5 text-xs text-slate-400">
        {trade.legs.map((leg, i) => (
          <div key={i} className="font-mono text-slate-200">
            {leg.action} {leg.strike} {leg.optionType} @₹{leg.premium}
            {leg.scripCode ? <span className="ml-1 text-slate-600">· #{leg.scripCode}</span> : <span className="ml-1 text-rose-500">· no scrip</span>}
          </div>
        ))}
      </div>
      <EnterPositionButton trade={trade} lotQty={lotQty} className="w-full text-sm" label="Enter this structure" />
    </div>
  );
}

function EnterPositionButton({
  trade,
  lotQty,
  label,
  className = "",
}: {
  trade: ScanTrade;
  lotQty: number;
  label: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const missingScrip = trade.legs.some((l) => !l.scripCode);
  return (
    <button
      type="button"
      disabled={missingScrip || busy}
      onClick={async () => {
        if (!window.confirm(
          `Place ${trade.legs.length} leg(s) in 5paisa — ${lotQty} qty each (1 NIFTY lot)?`,
        )) {
          return;
        }
        setBusy(true);
        try {
          const r = await api.trading.executeScan(
            trade.legs.map((l) => ({
              action: l.action,
              scripCode: l.scripCode,
              premium: l.premium,
            })),
            lotQty,
          );
          if (r.allOk) {
            window.alert(
              `OK — ${r.results.map((x) => (x.ok ? `Order ${x.orderId}` : `Fail ${x.error}`)).join("\n")}`,
            );
          } else {
            window.alert(
              r.results.map((x) => (x.ok ? `OK #${x.orderId}` : `ERR ${x.scripCode}: ${x.error}`)).join("\n") ||
                "No response",
            );
          }
        } catch (e) {
          window.alert(e instanceof Error ? e.message : "Request failed");
        } finally {
          setBusy(false);
        }
      }}
      className={`rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-amber-950 transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {missingScrip ? "Scrip codes missing in chain" : busy ? "Placing…" : label}
    </button>
  );
}

function AlternateCard({ trade, lotQty }: { trade: ScanTrade; lotQty: number }) {
  const tt = TRADE_TYPE_LABELS[trade.tradeType] || { icon: "?", label: trade.tradeType, color: "text-gray-400" };

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 transition-colors hover:border-slate-600">
      <StrategyFamilyRow tradeType={trade.tradeType} />
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span>{tt.icon}</span>
          <span className={`font-semibold ${tt.color}`}>{tt.label}</span>
        </div>
        <span className="rounded bg-gray-800 px-2 py-0.5 text-sm font-bold text-yellow-400">{trade.score}</span>
      </div>

      {/* Legs summary */}
      <div className="mb-2 space-y-0.5 text-xs">
        {trade.legs.map((leg, i) => (
          <div key={i} className="flex gap-2">
            <span className={leg.action === "SELL" ? "text-red-400" : "text-green-400"}>{leg.action}</span>
            <span className="font-mono text-white">{leg.strike}{leg.optionType}</span>
            <span className="text-gray-500">@₹{leg.premium}</span>
          </div>
        ))}
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-3 gap-1 text-xs">
        <div>
          <div className="text-gray-500">Win %</div>
          <div className={`font-mono font-semibold ${trade.winProbability >= 65 ? "text-green-400" : "text-yellow-400"}`}>
            {trade.winProbability}%
          </div>
        </div>
        <div>
          <div className="text-gray-500">EV</div>
          <div className={`font-mono font-semibold ${trade.expectedValue >= 0 ? "text-green-400" : "text-red-400"}`}>
            {trade.expectedValue >= 0 ? "+" : ""}₹{trade.expectedValue}
          </div>
        </div>
        <div>
          <div className="text-gray-500">Profit</div>
          <div className="font-mono font-semibold text-white">₹{trade.maxProfit.toLocaleString("en-IN")}</div>
        </div>
      </div>

      <p className="mt-2 truncate text-xs text-gray-500">{trade.edge}</p>
      <div className="mt-3">
        <EnterPositionButton trade={trade} lotQty={lotQty} className="w-full text-xs" label="Enter in broker" />
      </div>
    </div>
  );
}

// ─── Pro desk panels ────────────────────────

const ALGO_ACTION_STYLES: Record<
  AlgoAction,
  { border: string; bg: string; text: string; pill: string }
> = {
  ENTER: { border: "border-emerald-500/60", bg: "from-emerald-950/50 to-slate-950/80", text: "text-emerald-200", pill: "bg-emerald-600 text-white" },
  PREPARE: { border: "border-amber-500/50", bg: "from-amber-950/40 to-slate-950/80", text: "text-amber-100", pill: "bg-amber-600 text-white" },
  WAIT: { border: "border-slate-600", bg: "from-slate-900/80 to-slate-950/90", text: "text-slate-300", pill: "bg-slate-600 text-slate-100" },
  STAND_DOWN: { border: "border-rose-500/50", bg: "from-rose-950/30 to-slate-950/90", text: "text-rose-200", pill: "bg-rose-700 text-white" },
  NO_SETUP: { border: "border-slate-700", bg: "from-slate-900/60 to-slate-950/90", text: "text-slate-400", pill: "bg-slate-700 text-slate-200" },
};

function TradingAlgoPanel({ algo, daysToExpiry }: { algo: TradingAlgo; daysToExpiry: number }) {
  const st = ALGO_ACTION_STYLES[algo.suggestedAction] ?? ALGO_ACTION_STYLES.WAIT;
  const [notif, setNotif] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setNotif("unsupported");
      return;
    }
    setNotif(Notification.permission);
  }, []);

  const requestNotif = () => {
    if (!("Notification" in window)) return;
    void Notification.requestPermission().then((p) => setNotif(p));
  };

  return (
    <div
      className={`mb-6 overflow-hidden rounded-2xl border-2 ${st.border} bg-gradient-to-b ${st.bg} shadow-lg shadow-black/20`}
    >
      <div className="border-b border-white/5 px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Algo: entry &amp; exit</h2>
          <div className="flex flex-wrap items-center gap-2">
            {notif === "default" && (
              <button
                type="button"
                onClick={requestNotif}
                className="rounded-md bg-violet-600 px-2.5 py-1 text-[10px] font-medium text-white hover:bg-violet-500"
              >
                Enable browser entry alerts
              </button>
            )}
            {notif === "granted" && (
              <span className="text-[10px] text-emerald-500/90">Browser alerts on</span>
            )}
            {notif === "denied" && <span className="text-[10px] text-rose-500/80">Notifications blocked in browser</span>}
            <span className="text-[10px] text-slate-600">DTE {daysToExpiry}</span>
          </div>
        </div>
      </div>
      <div className="px-4 py-3">
        <div className="flex flex-wrap items-start gap-3">
          <span className={`rounded-md px-2.5 py-1 text-xs font-bold ${st.pill}`}>
            {algo.suggestedAction.replace(/_/g, " ")}
          </span>
          <div>
            <p className={`text-base font-semibold ${st.text}`}>{algo.entryHeadline}</p>
            <p className="mt-1 text-sm leading-relaxed text-slate-400">{algo.entryDetail}</p>
            <div className="mt-3 h-1.5 max-w-md overflow-hidden rounded-full bg-slate-800/80">
              <div
                className="h-full rounded-full bg-cyan-500/80 transition-all"
                style={{ width: `${Math.min(100, Math.max(4, algo.entryReadiness))}%` }}
              />
            </div>
            <p className="mt-0.5 text-[10px] text-slate-500">Readiness (model) {algo.entryReadiness}%</p>
          </div>
        </div>

        {algo.exitPlan && (
          <div className="mt-5 grid gap-3 border-t border-white/5 pt-4 sm:grid-cols-2">
            <div>
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-cyan-600/90">When to take profit (exit / scale)</h3>
              <ul className="mt-2 space-y-1.5 text-xs text-slate-300">
                <li>
                  <span className="text-slate-500">TP target: </span>
                  <span className="font-mono text-emerald-300">
                    ~₹{algo.exitPlan.takeProfitRupees.toLocaleString("en-IN")}
                  </span>
                  <span className="text-slate-500"> ({algo.exitPlan.takeProfitPctOfMaxProfit}% of model max profit)</span>
                </li>
                <li>
                  <span className="text-slate-500">Soft stop: </span>
                  <span className="font-mono text-amber-300">~₹{algo.exitPlan.softStopLossRupees.toLocaleString("en-IN")}</span>
                  <span className="text-slate-500"> (≈{algo.exitPlan.softStopPctOfMaxLoss}% of max loss)</span>
                </li>
                <li>
                  <span className="text-slate-500">Max loss (defined risk): </span>
                  <span className="font-mono text-rose-300/90">~₹{algo.exitPlan.hardStopLossRupees.toLocaleString("en-IN")}</span>
                </li>
                <li>
                  <span className="text-slate-500">Breakeven (model): </span>
                  <span className="font-mono text-slate-200">{algo.exitPlan.breakevenLevels}</span> — exit if spot &gt;{" "}
                  {algo.exitPlan.spotBufferPoints} pts through the wrong side
                </li>
              </ul>
            </div>
            <div>
              <h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Time &amp; vol</h3>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">{algo.exitPlan.timeExitRule}</p>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">{algo.exitPlan.ivExitRule}</p>
            </div>
          </div>
        )}

        {algo.alerts.length > 0 && (
          <ul className="mt-4 space-y-1 border-t border-white/5 pt-3 text-[11px] text-slate-500">
            {algo.alerts.map((a) => (
              <li key={a.id} className="flex gap-2">
                <span
                  className={
                    a.level === "critical" ? "text-rose-400" : a.level === "warning" ? "text-amber-400" : "text-slate-500"
                  }
                >
                  {a.kind}
                </span>
                <span>
                  <span className="font-medium text-slate-400">{a.title}:</span> {a.message}
                </span>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-3 text-[10px] leading-relaxed text-slate-600">
          Not financial advice. Alerts fire when the desk first goes to ENTER or the top-pick id changes. Track MTM in your
          broker; model uses chain snapshot, not your fill prices.
        </p>
      </div>
    </div>
  );
}

function ProSignalBanner({ signal }: { signal: ProSignal }) {
  const styles: Record<ProStatus, string> = {
    ACTIVE: "border-emerald-600/80 bg-emerald-950/40 text-emerald-200",
    STANDBY: "border-amber-600/80 bg-amber-950/40 text-amber-200",
    AVOID: "border-rose-600/80 bg-rose-950/40 text-rose-200",
    NO_TRADE: "border-slate-600 bg-slate-900/60 text-slate-300",
  };
  return (
    <div className={`mb-4 rounded-xl border-2 px-4 py-3 ${styles[signal.status]}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="rounded bg-black/30 px-2 py-1 text-xs font-bold uppercase tracking-wider">
            {signal.status}
          </span>
          <span className="text-sm font-medium">
            Alignment <span className="font-mono text-white">{signal.alignmentPct}%</span>
          </span>
        </div>
        <p className="text-xs opacity-90">{signal.label}</p>
      </div>
    </div>
  );
}

function FiiDiiPanel({ fii }: { fii: FiiDiiOut }) {
  if (!fii.dataAvailable) {
    return (
      <div className="mb-4 rounded-lg border border-slate-700 bg-slate-900/40 px-4 py-3 text-sm text-slate-500">
        <span className="font-semibold text-slate-400">FII / DII (cash &amp; derivatives)</span>
        <span className="ml-2">{fii.message ?? "Unavailable"}</span>
      </div>
    );
  }
  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-indigo-900/50 bg-indigo-950/20">
      <div className="border-b border-indigo-900/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-indigo-300">
        Institutional flow (NSE) {fii.asOf ? `· as of ${fii.asOf}` : ""}
        {fii.servedFromCache && fii.cacheNote && (
          <span className="ml-2 font-normal text-indigo-400/80">({fii.cacheNote})</span>
        )}
      </div>
      <div className="max-h-40 overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-indigo-950/80 text-indigo-400">
            <tr>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2 text-right">Buy ₹</th>
              <th className="px-3 py-2 text-right">Sell ₹</th>
              <th className="px-3 py-2 text-right">Net ₹</th>
            </tr>
          </thead>
          <tbody>
            {(fii.rows ?? []).map((r, i) => (
              <tr key={i} className="border-t border-indigo-900/30 text-slate-300">
                <td className="px-3 py-1.5">{r.category}</td>
                <td className="px-3 py-1.5 text-right font-mono">{(r.buyValue / 1e7).toFixed(2)} Cr</td>
                <td className="px-3 py-1.5 text-right font-mono">{(r.sellValue / 1e7).toFixed(2)} Cr</td>
                <td className={`px-3 py-1.5 text-right font-mono ${r.netValue >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  {(r.netValue / 1e7).toFixed(2)} Cr
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProIndicatorsPanel({ spot, ind }: { spot: number; ind: ProIndicators }) {
  const ch = ind.chain;
  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {ind.macd && (
        <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
          <div className="text-[10px] font-semibold uppercase text-slate-500">MACD (12,26,9)</div>
          <div className="mt-1 font-mono text-sm text-white">
            {ind.macd.macd.toFixed(2)} / {ind.macd.signal.toFixed(2)}
            <span className="ml-2 text-xs text-cyan-400">hist {ind.macd.histogram.toFixed(2)}</span>
          </div>
          <div className="text-xs text-slate-500">{ind.macd.bias}</div>
        </div>
      )}
      {ind.bollinger && (
        <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
          <div className="text-[10px] font-semibold uppercase text-slate-500">Bollinger (20,2)</div>
          <div className="mt-1 text-xs text-slate-300">
            %B {ind.bollinger.percentB.toFixed(2)} · width {ind.bollinger.widthPct.toFixed(1)}%
          </div>
          <div className="text-xs text-amber-400/90">{ind.bollinger.position.replace(/_/g, " ")}</div>
        </div>
      )}
      {ind.stochastic && (
        <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
          <div className="text-[10px] font-semibold uppercase text-slate-500">Stochastic (14,3)</div>
          <div className="mt-1 font-mono text-sm text-white">
            %K {ind.stochastic.k} · %D {ind.stochastic.d}
          </div>
          <div className="text-xs text-slate-500">{ind.stochastic.zone}</div>
        </div>
      )}
      {ch && (
        <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3 sm:col-span-2 lg:col-span-1">
          <div className="text-[10px] font-semibold uppercase text-slate-500">Chain &amp; max pain</div>
          <div className="mt-1 text-xs text-slate-300">
            Max pain <span className="font-mono text-white">{ch.maxPain}</span>
            {spot > 0 && ch.maxPain > 0 && (
              <span className="text-slate-500"> (∆{Math.abs(spot - ch.maxPain)} vs spot)</span>
            )}
          </div>
          <div className="text-xs text-slate-500">
            PCR OI {ch.pcrOI.toFixed(2)} · Vol {ch.pcrVolume.toFixed(2)} · IV skew ATM {ch.ivSkewATM.toFixed(1)}%
          </div>
        </div>
      )}
    </div>
  );
}

function OiBuildupPanel({ oi }: { oi: OiInsights }) {
  const col = (title: string, rows: OiLegRow[]) => (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-2">
      <div className="mb-1 text-[10px] font-semibold uppercase text-amber-500/90">{title}</div>
      <table className="w-full text-[10px]">
        <thead>
          <tr className="text-slate-500">
            <th className="py-0.5 text-left font-medium">K</th>
            <th className="text-right font-medium">OI</th>
            <th className="text-right font-medium">∆</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${title}-${r.strike}`} className="border-t border-slate-800/60 text-slate-300">
              <td className="font-mono py-0.5">{r.strike}</td>
              <td className="text-right text-slate-400">{formatLakh(r.oi)}</td>
              <td className={`text-right font-mono ${r.changeInOi >= 0 ? "text-emerald-500/90" : "text-rose-400"}`}>
                {r.changeInOi >= 0 ? "+" : ""}
                {formatLakh(r.changeInOi)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="mb-6 rounded-xl border border-amber-900/30 bg-amber-950/10 p-4">
      <h3 className="mb-1 text-sm font-semibold text-amber-200/90">OI build-up (chain)</h3>
      <p className="mb-3 text-xs leading-relaxed text-slate-400">{oi.narrative}</p>
      <div className="mb-3 flex flex-wrap gap-2 text-[11px]">
        <span className="rounded border border-slate-700 bg-slate-800/60 px-2 py-1 text-slate-300">
          CE net ∆ {formatLakh(oi.netCallOiChange)} <span className="text-slate-500">· {oi.callFlow}</span>
        </span>
        <span className="rounded border border-slate-700 bg-slate-800/60 px-2 py-1 text-slate-300">
          PE net ∆ {formatLakh(oi.netPutOiChange)} <span className="text-slate-500">· {oi.putFlow}</span>
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {col("CE — by OI", oi.topCallByOi)}
        {col("PE — by OI", oi.topPutByOi)}
        {col("CE — by ∆ OI (adds)", oi.topCallByOiChange)}
        {col("PE — by ∆ OI (adds)", oi.topPutByOiChange)}
      </div>
    </div>
  );
}

// ─── Small Components ───────────────────────

function MetricBox({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="rounded-lg bg-gray-800/80 p-3 text-center">
      <div className="text-[10px] uppercase text-gray-500">{label}</div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-600">{sub}</div>}
    </div>
  );
}

function FinBox({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="rounded bg-gray-800/60 px-3 py-2">
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className={`font-mono text-sm font-semibold ${
        positive === true ? "text-green-400" : positive === false ? "text-red-400" : "text-white"
      }`}>
        {value}
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────

function formatLakh(n: number): string {
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(1)}Cr`;
  if (n >= 100_000) return `${(n / 100_000).toFixed(1)}L`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}
