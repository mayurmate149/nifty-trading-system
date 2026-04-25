/**
 * Pro desk: classifies a ranked scan into ACTIVE / STANDBY / AVOID and
 * lists entry/exit conditions checked against the full indicator stack.
 */

import type { MarketIndicators } from "@/types/market";
import type { TechnicalSnapshot } from "@/server/market-data/technicals";
import type { ProfessionalIndicatorBundle } from "@/server/market-data/professional-indicators";
import type { FiiDiiSnapshot, FiiDiiUnavailable } from "@/server/market-data/fii-dii";

/** Minimal trade shape to avoid circular imports with auto-scanner */
export interface ScanTradeCore {
  netCredit: number;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  tradeType: string;
  legs: { action: "BUY" | "SELL"; optionType: "CE" | "PE"; strike: number; premium: number }[];
  targetTime: string;
  breakeven: number[];
  score: number;
}

export type ProSignalStatus = "ACTIVE" | "STANDBY" | "AVOID" | "NO_TRADE";

export interface SignalCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
  critical: boolean;
}

export interface ProTradePlaybook {
  structure: string;
  incomeSummary: string;
  hedgeOrLongSummary: string;
  executionNote: string;
}

export interface ProTradeSignal {
  status: ProSignalStatus;
  alignmentPct: number;
  label: string;
  entryChecks: SignalCheck[];
  exitGuidance: SignalCheck[];
  playbook: ProTradePlaybook;
}

function classifyLegs(trade: ScanTradeCore): ProTradePlaybook {
  const sells = trade.legs.filter((l) => l.action === "SELL");
  const buys = trade.legs.filter((l) => l.action === "BUY");
  const isCredit = trade.netCredit > 0;
  const income = sells
    .map((l) => `SELL ${l.strike} ${l.optionType} @₹${l.premium}`)
    .join(" · ");
  const hedge = buys
    .map((l) => `BUY ${l.strike} ${l.optionType} @₹${l.premium} (hedge / defined risk)`)
    .join(" · ");
  let structure: string;
  if (isCredit && buys.length) {
    structure = "Credit + hedge: collect premium, cap risk on far wing.";
  } else if (isCredit && !buys.length) {
    structure = "Short premium (uncapped — use size & stops per risk policy).";
  } else {
    structure = "Long premium / directional: pay debit; time decay is headwind — plan exit.";
  }
  return {
    structure,
    incomeSummary: income || "—",
    hedgeOrLongSummary: hedge || (isCredit ? "No long legs — not a defined-risk structure." : "—"),
    executionNote: "Size to margin; adjust wings if bid–ask is wide. Slippage not modeled.",
  };
}

export function buildProTradeSignal(
  trade: ScanTradeCore | null,
  ind: MarketIndicators,
  tech: TechnicalSnapshot,
  spot: number,
  pro: ProfessionalIndicatorBundle | undefined,
  fiiDii: FiiDiiSnapshot | FiiDiiUnavailable | null,
): ProTradeSignal {
  const playbook: ProTradePlaybook = trade
    ? classifyLegs(trade)
    : {
        structure: "No structure — wait for a positive-EV setup.",
        incomeSummary: "—",
        hedgeOrLongSummary: "—",
        executionNote: "—",
      };

  if (!trade) {
    return {
      status: "NO_TRADE",
      alignmentPct: 0,
      label: "No positive-EV structure — do not force a trade",
      entryChecks: [],
      exitGuidance: defaultExitTemplate(),
      playbook,
    };
  }

  const entry: SignalCheck[] = [];
  const isSeller = trade.netCredit > 0;
  const dir = trade.direction;

  // Trend / structure
  const trendOk =
    (dir === "BULLISH" && ind.trend === "trend-up") ||
    (dir === "BEARISH" && ind.trend === "trend-down") ||
    (dir === "NEUTRAL" && (ind.trend === "range-bound" || ind.trend.includes("range")));
  entry.push({
    id: "trend",
    label: "Trend vs structure",
    passed: trendOk,
    detail: `Spot trend ${ind.trend}, trade is ${dir}`,
    critical: true,
  });

  const stOk =
    (dir === "BULLISH" && tech.superTrendSignal === "BUY") ||
    (dir === "BEARISH" && tech.superTrendSignal === "SELL") ||
    (dir === "NEUTRAL");
  entry.push({
    id: "supertrend",
    label: "SuperTrend",
    passed: stOk,
    detail: `Signal ${tech.superTrendSignal} vs ${dir}`,
    critical: true,
  });

  const emaOk =
    (dir === "BULLISH" && tech.emaCrossover !== "BEARISH") ||
    (dir === "BEARISH" && tech.emaCrossover !== "BULLISH") ||
    (dir === "NEUTRAL");
  entry.push({
    id: "ema",
    label: "EMA9 vs EMA21",
    passed: emaOk,
    detail: tech.emaCrossover,
    critical: true,
  });

  const vwapOk =
    (dir === "BULLISH" && tech.priceVsVwap !== "BELOW") ||
    (dir === "BEARISH" && tech.priceVsVwap !== "ABOVE") ||
    (dir === "NEUTRAL");
  entry.push({
    id: "vwap",
    label: "Price vs VWAP",
    passed: vwapOk,
    detail: tech.priceVsVwap,
    critical: false,
  });

  const rsiInBand =
    dir === "BULLISH"
      ? tech.rsi >= 38 && tech.rsi < 72
      : dir === "BEARISH"
        ? tech.rsi > 28 && tech.rsi <= 65
        : tech.rsi >= 36 && tech.rsi <= 64;
  entry.push({
    id: "rsi",
    label: "RSI band",
    passed: rsiInBand,
    detail: `RSI(14) ${tech.rsi}`,
    critical: false,
  });

  const vixOk = ind.vix < 32;
  entry.push({
    id: "vix",
    label: "VIX not in panic",
    passed: vixOk,
    detail: `VIX ${ind.vix.toFixed(1)}`,
    critical: true,
  });

  const ivOk = isSeller ? ind.ivPercentile >= 25 : ind.ivPercentile <= 50;
  entry.push({
    id: "iv",
    label: isSeller ? "IV percentile (sellers need edge)" : "IV for buyers (avoid extreme IV)",
    passed: ivOk,
    detail: `IV pctl ${ind.ivPercentile}%`,
    critical: false,
  });

  if (pro?.chain) {
    const dMp = pro.chain.maxPain > 0 ? Math.abs(spot - pro.chain.maxPain) : 9999;
    const band = Math.max(200, spot * 0.004);
    const mpOk = dMp < band;
    entry.push({
      id: "maxpain",
      label: "Spot vs max-pain (pin context)",
      passed: mpOk,
      detail: `Max pain ${pro.chain.maxPain} · spot ${spot} (∆${dMp} pts)`,
      critical: false,
    });
  }

  if (pro?.macd) {
    const mOk =
      (dir === "BULLISH" && pro.macd.bias !== "BEARISH") ||
      (dir === "BEARISH" && pro.macd.bias !== "BULLISH") ||
      (dir === "NEUTRAL");
    entry.push({
      id: "macd",
      label: "MACD histogram",
      passed: mOk,
      detail: `MACD ${pro.macd.macd} / sig ${pro.macd.signal} (${pro.macd.bias})`,
      critical: false,
    });
  }

  if (pro?.bollinger) {
    const bOk = dir === "BULLISH" ? pro.bollinger.percentB > 0.2 : dir === "BEARISH" ? pro.bollinger.percentB < 0.85 : true;
    entry.push({
      id: "boll",
      label: "Bollinger %B",
      passed: bOk,
      detail: `pos ${pro.bollinger.position} %B ${pro.bollinger.percentB}`,
      critical: false,
    });
  }

  if (pro?.stochastic) {
    const sOk =
      dir === "BULLISH"
        ? pro.stochastic.zone !== "OVERBOUGHT"
        : dir === "BEARISH"
          ? pro.stochastic.zone !== "OVERSOLD"
          : pro.stochastic.zone === "NEUTRAL";
    entry.push({
      id: "stoch",
      label: "Stochastic",
      passed: sOk,
      detail: `K ${pro.stochastic.k} D ${pro.stochastic.d} (${pro.stochastic.zone})`,
      critical: false,
    });
  }

  if (pro?.oiInsights) {
    const oi = pro.oiInsights;
    const oiPass =
      dir === "NEUTRAL"
        ? true
        : dir === "BULLISH"
          ? oi.netPutOiChange >= 0 || oi.putFlow !== "UNWIND"
          : oi.netCallOiChange >= 0 || oi.callFlow !== "UNWIND";
    entry.push({
      id: "oi_build",
      label: "OI build-up (chain)",
      passed: oiPass,
      detail: `${oi.narrative} (CE ${oi.callFlow} / PE ${oi.putFlow})`,
      critical: false,
    });
  }

  if (fiiDii && fiiDii.dataAvailable) {
    const fii = fiiDii.rows.find(
      (r) => r.category.toLowerCase().includes("fii") && r.category.toLowerCase().includes("cash"),
    );
    const softBull = fii == null || fii.netValue >= 0;
    const softBear = fii == null || fii.netValue <= 0;
    const fiiOk = dir === "BULLISH" ? softBull : dir === "BEARISH" ? softBear : true;
    entry.push({
      id: "fii_cash",
      label: "FII cash (soft read)",
      passed: fiiOk,
      detail: fii
        ? `Net ₹${(fii.netValue / 1e7).toFixed(2)} Cr (directional soft filter)`
        : "Row not found — ignore",
      critical: false,
    });
  } else {
    entry.push({
      id: "fii_cash",
      label: "FII / DII feed",
      passed: true,
      detail:
        fiiDii && !fiiDii.dataAvailable
          ? fiiDii.message
          : "NSE session feed unavailable",
      critical: false,
    });
  }

  const critical = entry.filter((c) => c.critical);
  const passedCrit = critical.filter((c) => c.passed).length;
  const allCritOk = passedCrit === critical.length;
  const passedAll = entry.filter((c) => c.passed).length;
  const alignmentPct = entry.length > 0 ? Math.round((passedAll / entry.length) * 100) : 0;

  const exit: SignalCheck[] = defaultExitForTrade(trade, tech, ind);

  let status: ProSignalStatus = "STANDBY";
  if (trade.score >= 55 && allCritOk && alignmentPct >= 65) {
    status = "ACTIVE";
  } else if (!allCritOk || ind.vix >= 32 || trade.score < 40) {
    status = "AVOID";
  } else {
    status = "STANDBY";
  }

  const label =
    status === "ACTIVE"
      ? "Aligned — you may work this structure with normal risk; manage exits on rules below."
      : status === "STANDBY"
        ? "Partial alignment — size down or wait for more factors to line up."
        : status === "AVOID"
          ? "Conditions not aligned — do not add size; favor standing aside."
          : "—";

  return { status, alignmentPct, label, entryChecks: entry, exitGuidance: exit, playbook };
}

function defaultExitTemplate(): SignalCheck[] {
  return [
    {
      id: "ex1",
      label: "VIX expansion",
      passed: true,
      detail: "If VIX jumps sharply vs entry, re‑gamma — tighten or close.",
      critical: false,
    },
    {
      id: "ex2",
      label: "SuperTrend flip",
      passed: true,
      detail: "SuperTrend / structure breaks against you → reduce or book.",
      critical: false,
    },
  ];
}

function defaultExitForTrade(
  trade: ScanTradeCore,
  tech: TechnicalSnapshot,
  _ind: MarketIndicators,
): SignalCheck[] {
  const be = trade.breakeven.map((b) => b.toFixed(0)).join(" / ");
  return [
    {
      id: "ex_spot",
      label: "Breakeven / buffer",
      passed: true,
      detail: `Watch spot vs BE ${be}; through BE with rising IV → exit rule.`,
      critical: false,
    },
    {
      id: "ex_theta",
      label: "Theta + time",
      passed: true,
      detail: `Target horizon: ${trade.targetTime}. If decay stalls and spot ranges against short wings, re‑evaluate.`,
      critical: false,
    },
    {
      id: "ex_st",
      label: "Trend tool flip",
      passed: true,
      detail: `Current ST ${tech.superTrendSignal} — if it flips against your short deltas, consider reducing.`,
      critical: false,
    },
  ];
}
