/**
 * Algo-style entry / exit plan for the auto-scanner: concrete ₹ targets, time/vol rules,
 * and machine-readable alerts. Complements `buildProTradeSignal` (qualitative checks).
 */

import type { ProTradeSignal } from "./scan-signal";

export type AlgoSuggestedAction = "ENTER" | "PREPARE" | "WAIT" | "STAND_DOWN" | "NO_SETUP";

export interface AlgoExitPlan {
  /** Book ~this much profit (₹) on the full position size modeled by scanner (per structure). */
  takeProfitRupees: number;
  takeProfitPctOfMaxProfit: number;
  /** Reduce or close if cumulative loss approaches this (₹). */
  softStopLossRupees: number;
  softStopPctOfMaxLoss: number;
  /** Close before loss exceeds this — matches defined-risk max for spreads/condor. */
  hardStopLossRupees: number;
  /** Spot vs breakeven: exit or tighten if spot goes this many points *past* the dangerous side of BE. */
  spotBufferPoints: number;
  breakevenLevels: string;
  timeExitRule: string;
  ivExitRule: string;
  /** Short bullet list for UI */
  checklists: { label: string; detail: string }[];
}

export interface ScanTradingAlgoAlert {
  id: string;
  kind: "ENTRY" | "EXIT" | "RISK" | "TIME" | "INFO";
  level: "info" | "warning" | "critical";
  title: string;
  message: string;
  /** Client may show a browser notification once per fingerprint transition */
  fireBrowser: boolean;
}

export interface ScanTradingAlgo {
  /** What to do right now, derived from pro signal + score + VIX + DTE */
  suggestedAction: AlgoSuggestedAction;
  entryHeadline: string;
  entryDetail: string;
  /** 0–100: how “ready” the book is to enter (for PREPARE/WAIT) */
  entryReadiness: number;
  /** Stable key for client deduplication of alerts */
  fingerprint: string;
  /** True when this scan suggests considering an open / add */
  isEntryWindow: boolean;
  exitPlan: AlgoExitPlan | null;
  alerts: ScanTradingAlgoAlert[];
}

export interface BuildTradingAlgoInput {
  bestTrade: {
    id: string;
    tradeType: string;
    direction: "BULLISH" | "BEARISH" | "NEUTRAL";
    netCredit: number;
    maxProfit: number;
    maxLoss: number;
    breakeven: number[];
    score: number;
    expectedValue: number;
    legs: unknown[];
  } | null;
  proSignal: ProTradeSignal;
  marketContext: {
    spot: number;
    vix: number;
    expectedMove: number;
    /** Days to current expiry in chain */
    daysToExpiry: number;
  };
}

const r0 = (n: number) => Math.round(n);

function buildExitPlan(
  trade: NonNullable<BuildTradingAlgoInput["bestTrade"]>,
  ctx: BuildTradingAlgoInput["marketContext"],
): AlgoExitPlan {
  const isShortPremium = trade.netCredit > 0;
  const tpPct = isShortPremium ? 50 : 40;
  const softPct = isShortPremium ? 50 : 55;
  const takeProfitRupees = r0((tpPct / 100) * trade.maxProfit);
  const softStopLossRupees = r0((softPct / 100) * Math.max(1, trade.maxLoss));
  const hardStopLossRupees = r0(trade.maxLoss);
  const be = trade.breakeven.map((b) => b.toFixed(0)).join(" / ");
  const spotBuffer = r0(Math.min(50, Math.max(15, ctx.expectedMove * 0.12)));

  const dte = ctx.daysToExpiry;
  let timeExitRule: string;
  if (dte <= 0) {
    timeExitRule = "Expiry session: avoid new risk; if short premium, be flat or hedged by exchange rules.";
  } else if (dte <= 1 && isShortPremium) {
    timeExitRule = "0–1 DTE: gamma risk is high. Close or roll winners by afternoon; do not add naked shorts.";
  } else if (dte <= 2 && isShortPremium) {
    timeExitRule = "≤2 DTE: favor taking 40–50% of max profit early; do not let winners become lottery tickets into expiry.";
  } else {
    timeExitRule = "Hold only while spot stays on the safe side of breakeven and VIX is stable. Re-scan daily.";
  }

  const ivExitRule =
    ctx.vix >= 28
      ? "If VIX is up 3+ points from your entry day, re-check margin and g — often exit or cut size."
      : "If VIX spikes sharply vs entry, close short-vega structures first (spreads, strangle, condor).";

  const checklists: AlgoExitPlan["checklists"] = [
    { label: "Profit", detail: `Target booking ~₹${takeProfitRupees.toLocaleString("en-IN")} (≈${tpPct}% of model max profit ₹${r0(trade.maxProfit).toLocaleString("en-IN")}).` },
    { label: "Soft stop", detail: `If loss ~₹${softStopLossRupees.toLocaleString("en-IN")} (≈${softPct}% of model max loss), cut or convert.` },
    { label: "Hard cap", detail: `Defined risk: do not let loss exceed ~₹${hardStopLossRupees.toLocaleString("en-IN")} (full width).` },
    { label: "Spot", detail: `If spot goes ${spotBuffer} pts through your breakeven vs model, treat as full exit for that thesis.` },
  ];

  if (!isShortPremium) {
    checklists[0] = {
      label: "Profit",
      detail: `On long premium: look to book near ₹${takeProfitRupees.toLocaleString("en-IN")} if M2M > ~${tpPct}% of model max, or on clear reversal.`,
    };
  }

  return {
    takeProfitRupees,
    takeProfitPctOfMaxProfit: tpPct,
    softStopLossRupees,
    softStopPctOfMaxLoss: softPct,
    hardStopLossRupees,
    spotBufferPoints: spotBuffer,
    breakevenLevels: be,
    timeExitRule,
    ivExitRule,
    checklists,
  };
}

/**
 * Fuses pro signal, scan score, VIX, and DTE into a single action + numeric exit plan.
 */
export function buildScanTradingAlgo(input: BuildTradingAlgoInput): ScanTradingAlgo {
  const { bestTrade, proSignal, marketContext: ctx } = input;
  const alerts: ScanTradingAlgoAlert[] = [];
  const vix = ctx.vix;
  const dte = ctx.daysToExpiry;

  if (!bestTrade) {
    return {
      suggestedAction: "NO_SETUP",
      entryHeadline: "No qualified structure",
      entryDetail: proSignal.status === "NO_TRADE" ? "Scanner did not find a +EV / ranked trade. Wait for the next session or refresh data." : "No best trade to plan.",
      entryReadiness: 0,
      fingerprint: `none|${r0(ctx.spot)}|${vix}`,
      isEntryWindow: false,
      exitPlan: null,
      alerts: [
        {
          id: "a_no_setup",
          kind: "INFO",
          level: "info",
          title: "No entry",
          message: "No trade object — do not open risk off this tick.",
          fireBrowser: false,
        },
      ],
    };
  }

  const crit = proSignal.entryChecks.filter((c) => c.critical);
  const critOk = crit.length > 0 && crit.every((c) => c.passed);
  const evOk = bestTrade.expectedValue > 0;
  const strongScore = bestTrade.score >= 58;
  const okScore = bestTrade.score >= 48;
  const lowScore = bestTrade.score < 40;

  let suggestedAction: AlgoSuggestedAction;
  let entryHeadline: string;
  let entryDetail: string;
  let entryReadiness: number;
  let isEntryWindow = false;

  if (proSignal.status === "AVOID" || (lowScore && proSignal.status !== "ACTIVE") || vix >= 32) {
    suggestedAction = "STAND_DOWN";
    entryHeadline = "Do not add size";
    const reasons: string[] = [];
    if (proSignal.status === "AVOID") reasons.push("pro signal: AVOID");
    if (vix >= 32) reasons.push("VIX stress band");
    if (lowScore) reasons.push("low model score");
    entryDetail = reasons.length ? `Reasons: ${reasons.join(" · ")}.` : "Conditions not safe for new risk.";
    entryReadiness = Math.max(0, proSignal.alignmentPct - 40);
  } else if (proSignal.status === "ACTIVE" && critOk && evOk && strongScore && vix < 30) {
    suggestedAction = "ENTER";
    entryHeadline = "Entry window (model)";
    entryDetail =
      "Pro stack ACTIVE, critical checks pass, +EV, score ≥ 58, VIX not in panic. Size per your cap; use exit plan below.";
    entryReadiness = 92;
    isEntryWindow = true;
  } else if (proSignal.status === "ACTIVE" && critOk && evOk && okScore) {
    suggestedAction = "ENTER";
    entryHeadline = "Entry possible";
    entryDetail = "Pro ACTIVE and checks pass, but not maximum score — use reduced size or wait one refresh for confirmation.";
    entryReadiness = 78;
    isEntryWindow = true;
  } else if (proSignal.status === "STANDBY" && okScore && vix < 32) {
    suggestedAction = "PREPARE";
    entryHeadline = "Partial alignment";
    entryDetail =
      "STANDBY: some filters failed or alignment below 65%. Stage legs or size down, or wait for STANDBY to become ACTIVE on later scans if you are strict.";
    entryReadiness = Math.min(70, proSignal.alignmentPct);
  } else {
    suggestedAction = "WAIT";
    entryHeadline = "Wait";
    entryDetail = "No clean entry under desk rules. Watch VIX, trend flip, and next scan for ACTIVE + score.";
    entryReadiness = Math.max(20, proSignal.alignmentPct - 10);
  }

  if (dte <= 1 && bestTrade.netCredit > 0) {
    alerts.push({
      id: "a_dte",
      kind: "TIME",
      level: "warning",
      title: "Expiry proximity",
      message: "Short premium near expiry: prefer smaller size, faster profit-taking, no new unhedged short legs.",
      fireBrowser: suggestedAction === "ENTER",
    });
  }

  if (suggestedAction === "ENTER" || suggestedAction === "PREPARE") {
    alerts.push({
      id: "a_entry",
      kind: "ENTRY",
      level: suggestedAction === "ENTER" ? "info" : "warning",
      title: suggestedAction === "ENTER" ? "Entry signal (desk rules)" : "Prepare only",
      message: entryHeadline + " — " + entryDetail,
      fireBrowser: suggestedAction === "ENTER" && isEntryWindow,
    });
  }

  if (suggestedAction === "STAND_DOWN" || suggestedAction === "WAIT") {
    alerts.push({
      id: "a_wait",
      kind: "INFO",
      level: "warning",
      title: "No new entry this tick",
      message: entryDetail,
      fireBrowser: false,
    });
  }

  const exitPlan = buildExitPlan(bestTrade, ctx);

  alerts.push({
    id: "a_exit",
    kind: "EXIT",
    level: "info",
    title: "Exit / manage",
    message: `TP ~₹${exitPlan.takeProfitRupees.toLocaleString("en-IN")} · soft stop ~₹${exitPlan.softStopLossRupees.toLocaleString("en-IN")} · BE ${exitPlan.breakevenLevels}`,
    fireBrowser: false,
  });

  const fp = [
    bestTrade.id,
    suggestedAction,
    r0(ctx.spot / 20),
    r0(vix),
    r0(bestTrade.score),
  ].join("|");

  return {
    suggestedAction,
    entryHeadline,
    entryDetail,
    entryReadiness: r0(entryReadiness),
    fingerprint: fp,
    isEntryWindow,
    exitPlan,
    alerts,
  };
}

export function formatAlgoForLog(algo: ScanTradingAlgo): string {
  if (!algo.exitPlan) return `${algo.suggestedAction} | ${algo.entryHeadline}`;
  const e = algo.exitPlan;
  return (
    `${algo.suggestedAction} | TP ~${e.takeProfitRupees} | soft ~${e.softStopLossRupees} | hard ${e.hardStopLossRupees} | ` +
    `BE ${e.breakevenLevels}`
  );
}
