/**
 * Strategy Monitor Engine — Pro Trader's Desk
 *
 * Runs every configured strategy's rule set against a shared live context
 * (indicators + technicals + professional indicators + option chain) and
 * returns one UI-ready card per strategy:
 *
 *   - Readiness (READY / ARMED / WAIT / AVOID)
 *   - Weighted match %
 *   - Every rule with group, pass/fail, detail, critical flag and weight
 *   - A concrete strike pick from the live chain (legs, premiums, max P/L,
 *     breakeven, margin estimate) ready for `execute-scan`
 *   - A stable fingerprint so the client can detect new triggers
 */

import type { MarketIndicators, OptionsChainResponse } from "@/types/market";
import type { StrategyLeg, StrategyType } from "@/types/strategy";
import { STRATEGY_META } from "@/types/strategy";
import type { TechnicalSnapshot } from "@/server/market-data/technicals";
import type { ProfessionalIndicatorBundle } from "@/server/market-data/professional-indicators";
import { computeMaxPain } from "@/server/market-data/professional-indicators";

import { ALL_STRATEGY_RULES } from "./strategies";
import {
  evaluateStrategyRules,
  type EvaluatedRule,
  type GroupSummary,
  type Readiness,
} from "./strategy-rules/run";
import type { ChainDerived, StrategyEvalContext } from "./strategy-rules/types";

import { selectStrikes, type StrikeSelection } from "./strike-selector";

// ─── Types ──────────────────────────────────────────────────────────────────

export type StrategyMonitorStatus = Readiness;

export interface MonitorPickLeg {
  action: "BUY" | "SELL";
  optionType: "CE" | "PE";
  strike: number;
  premium: number;
  iv: number;
  oi: number;
  scripCode?: number;
}

export interface MonitorPick {
  legs: MonitorPickLeg[];
  netCredit: number;          // + credit / − debit (per share)
  maxProfit: number;          // ₹ per lot
  maxLoss: number;            // ₹ per lot
  breakeven: number[];
  marginEstimate: number;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
}

export interface MonitorRule {
  id: string;
  group: EvaluatedRule["group"];
  label: string;
  weight: 1 | 2 | 3;
  critical: boolean;
  passed: boolean;
  detail: string;
}

export interface MonitorGroup {
  group: GroupSummary["group"];
  passed: number;
  total: number;
  weightPassed: number;
  weightTotal: number;
}

export interface StrategyMonitorCard {
  key: StrategyType;
  name: string;
  icon: string;
  bias: "CREDIT" | "DEBIT";
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  legs: number;
  riskProfile: "LIMITED" | "UNLIMITED";
  summary: string;
  status: StrategyMonitorStatus;
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

export interface StrategyMonitorSnapshot {
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
    // Selected technicals surfaced in the header for the trader
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
  strategies: StrategyMonitorCard[];
}

export interface MonitorInput {
  chain: OptionsChainResponse;
  indicators: MarketIndicators;
  technicals: TechnicalSnapshot;
  professional: ProfessionalIndicatorBundle;
  spot: number;
  lotSize: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildChainDerived(
  chain: OptionsChainResponse,
  indicators: MarketIndicators,
  professional: ProfessionalIndicatorBundle,
): ChainDerived {
  const proChain = professional.chain;
  const maxCallStrike = chain.maxCallOIStrike;
  const maxPutStrike = chain.maxPutOIStrike;
  const atmRow = chain.chain.find((s) => s.strike === chain.atmStrike);
  const atmStraddle = atmRow ? atmRow.ce.ltp + atmRow.pe.ltp : 0;
  const expectedMovePts = Math.round(atmStraddle * 0.85); // ~1σ approx

  return {
    atmStrike: chain.atmStrike,
    maxCallOI: {
      strike: maxCallStrike,
      oi: chain.chain.find((s) => s.strike === maxCallStrike)?.ce.oi ?? 0,
    },
    maxPutOI: {
      strike: maxPutStrike,
      oi: chain.chain.find((s) => s.strike === maxPutStrike)?.pe.oi ?? 0,
    },
    maxPain: proChain?.maxPain ?? computeMaxPain(chain.chain),
    pcrOI: proChain?.pcrOI ?? chain.pcr ?? indicators.pcr,
    pcrVolume: proChain?.pcrVolume ?? 0,
    ivSkewATM: proChain?.ivSkewATM ?? 0,
    atmStraddle,
    expectedMovePts,
  };
}

function rankSelections(
  strategy: StrategyType,
  selections: StrikeSelection[],
  chain: OptionsChainResponse,
): StrikeSelection | null {
  if (selections.length === 0) return null;
  const meta = STRATEGY_META[strategy];

  // Economic score: Credit strategies maximise profit + R:R; debit strategies
  // trade profit vs loss.
  const economic = (s: StrikeSelection): number => {
    const rr = s.maxLoss > 0 ? s.maxProfit / s.maxLoss : 0;
    return meta.bias === "CREDIT"
      ? s.maxProfit * 0.4 + rr * 6000 * 0.6
      : s.maxProfit * 0.7 - s.maxLoss * 0.3;
  };

  // Every leg needs a live scripCode or the Enter button can't place orders.
  // Rank first by "all legs tradeable", then economic score.
  const scored = selections.map((s) => {
    const tradeable = allLegsTradeable(s, chain);
    return { s, score: economic(s), tradeable };
  });

  scored.sort((a, b) => {
    if (a.tradeable !== b.tradeable) return a.tradeable ? -1 : 1;
    return b.score - a.score;
  });

  return scored[0].s;
}

function allLegsTradeable(
  sel: StrikeSelection,
  chain: OptionsChainResponse,
): boolean {
  for (const leg of sel.legs) {
    const strikeRow = chain.chain.find((s) => s.strike === leg.strike);
    if (!strikeRow) return false;
    const row = leg.type.includes("CALL") ? strikeRow.ce : strikeRow.pe;
    const sc = row?.scripCode;
    if (sc == null || sc === "" || Number(sc) <= 0) return false;
  }
  return true;
}

function selectionToPick(
  sel: StrikeSelection,
  chain: OptionsChainResponse,
  strategy: StrategyType,
): MonitorPick {
  const legs: MonitorPickLeg[] = sel.legs.map((leg) => {
    const action: "BUY" | "SELL" = leg.type.startsWith("BUY") ? "BUY" : "SELL";
    const optionType: "CE" | "PE" = leg.type.includes("CALL") ? "CE" : "PE";
    const strikeRow = chain.chain.find((s) => s.strike === leg.strike);
    const row = optionType === "CE" ? strikeRow?.ce : strikeRow?.pe;
    const scripCode = row?.scripCode != null ? Number(row.scripCode) : undefined;
    return {
      action,
      optionType,
      strike: leg.strike,
      premium: leg.premium,
      iv: leg.iv,
      oi: leg.oi,
      scripCode: Number.isFinite(scripCode) ? (scripCode as number) : undefined,
    };
  });
  const meta = STRATEGY_META[strategy];
  const marginEstimate =
    meta.riskProfile === "LIMITED"
      ? Math.max(sel.maxLoss, 5000)
      : Math.max(sel.maxLoss * 0.4, 50000);

  return {
    legs,
    netCredit: sel.netPremium,
    maxProfit: sel.maxProfit,
    maxLoss: sel.maxLoss,
    breakeven: sel.breakeven,
    marginEstimate: Math.round(marginEstimate),
    direction: sel.direction,
  };
}

function fingerprintPick(strategy: StrategyType, pick: MonitorPick | null): string {
  if (!pick) return `${strategy}:none`;
  const legKey = pick.legs
    .map((l) => `${l.action}${l.optionType}${l.strike}`)
    .join("|");
  return `${strategy}:${legKey}`;
}

// ─── Main entry ─────────────────────────────────────────────────────────────

export function buildStrategyMonitor(input: MonitorInput): StrategyMonitorSnapshot {
  const { chain, indicators, technicals, professional, spot, lotSize } = input;

  const chainDerived = buildChainDerived(chain, indicators, professional);

  const ctx: StrategyEvalContext = {
    spot,
    indicators,
    technicals,
    professional,
    chain,
    chainDerived,
  };

  const cards: StrategyMonitorCard[] = ALL_STRATEGY_RULES.map((def) => {
    const evalResult = evaluateStrategyRules(def, ctx);

    // Only price a concrete pick when the setup is at least plausible —
    // avoids wasted chain lookups when AVOID, and gives ARMED/WAIT cards a
    // tangible preview anyway.
    let pick: MonitorPick | null = null;
    if (evalResult.readiness !== "AVOID") {
      const selections = selectStrikes(
        def.key,
        spot,
        chain.chain,
        indicators.trend,
        lotSize,
      );
      const top = rankSelections(def.key, selections, chain);
      if (top) pick = selectionToPick(top, chain, def.key);
    }

    return {
      key: def.key,
      name: def.name,
      icon: def.icon,
      bias: def.bias,
      direction: def.direction,
      legs: def.legs,
      riskProfile: def.riskProfile,
      summary: def.summary,
      status: evalResult.readiness,
      matchPct: evalResult.matchPct,
      headline: evalResult.headline,
      rules: evalResult.rules,
      groups: evalResult.groups,
      criticalsFailed: evalResult.criticalsFailed,
      pick,
      exitRules: def.exitRules,
      fingerprint: fingerprintPick(def.key, pick),
    };
  });

  const counts = {
    ready: cards.filter((c) => c.status === "READY").length,
    armed: cards.filter((c) => c.status === "ARMED").length,
    wait: cards.filter((c) => c.status === "WAIT").length,
    avoid: cards.filter((c) => c.status === "AVOID").length,
  };

  return {
    generatedAt: new Date().toISOString(),
    marketContext: {
      spot: indicators.spot,
      spotChange: indicators.spotChange,
      spotChangePct: indicators.spotChangePct,
      vix: indicators.vix,
      pcr: chainDerived.pcrOI,
      trend: indicators.trend,
      trendStrength: indicators.trendStrength,
      ivPercentile: indicators.ivPercentile,
      daysToExpiry: indicators.daysToExpiry,
      expiry: indicators.expiry,
      atmStrike: chainDerived.atmStrike,
      maxCallOI: chainDerived.maxCallOI,
      maxPutOI: chainDerived.maxPutOI,
      maxPain: chainDerived.maxPain,
      atmStraddle: chainDerived.atmStraddle,
      expectedMovePts: chainDerived.expectedMovePts,
      rsi: technicals.rsi,
      ema9: technicals.ema9,
      ema21: technicals.ema21,
      emaCrossover: technicals.emaCrossover,
      superTrendSignal: technicals.superTrendSignal,
      vwap: technicals.vwap,
      priceVsVwap: technicals.priceVsVwap,
      macdBias: professional.macd?.bias ?? null,
      bollingerPosition: professional.bollinger?.position ?? null,
      bollingerWidthPct: professional.bollinger?.widthPct ?? null,
      stochasticZone: professional.stochastic?.zone ?? null,
    },
    counts,
    strategies: cards,
  };
}
