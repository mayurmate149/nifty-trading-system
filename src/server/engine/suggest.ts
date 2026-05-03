/**
 * Trade Suggestion Engine — 8-strategy rule-based scanner
 *
 * Thin wrapper over the rule engine: evaluates every strategy, picks the best
 * live strike selection from `selectStrikes`, and converts the result into
 * the legacy `TradeSuggestion` shape the /trade-suggestions page consumes.
 */

import {
  StrategyType,
  TradeSuggestion,
  ConfidenceTier,
  SuggestRequest,
  SuggestResponse,
  STRATEGY_META,
} from "@/types/strategy";
import {
  MarketIndicators,
  OptionsChainResponse,
} from "@/types/market";
import type { TechnicalSnapshot } from "@/server/market-data/technicals";
import type { ProfessionalIndicatorBundle } from "@/server/market-data/professional-indicators";
import { computeMaxPain } from "@/server/market-data/professional-indicators";
import { selectStrikes } from "./strike-selector";
import { scoreStrategy } from "./scorer";
import { ALL_STRATEGY_RULES } from "./strategies";
import { evaluateStrategyRules } from "./strategy-rules/run";
import type {
  ChainDerived,
  StrategyEvalContext,
  StrategyRules,
} from "./strategy-rules/types";

// ─── Registry (strategy → rules) ────────────────────────────────────────────

const STRATEGY_RULES: Record<StrategyType, StrategyRules> = Object.fromEntries(
  ALL_STRATEGY_RULES.map((r) => [r.key, r]),
) as Record<StrategyType, StrategyRules>;

const ALL_STRATEGIES: StrategyType[] = ALL_STRATEGY_RULES.map((r) => r.key);

const CREDIT_STRATEGIES = new Set<StrategyType>(
  ALL_STRATEGY_RULES.filter((r) => r.bias === "CREDIT").map((r) => r.key),
);

// ─── Main Engine ────────────────────────────────────────────────────────────

export interface EngineInput {
  indicators: MarketIndicators;
  chainResponse: OptionsChainResponse;
  technicals: TechnicalSnapshot;
  professional: ProfessionalIndicatorBundle;
  request: SuggestRequest;
}

export function generateSuggestions(input: EngineInput): SuggestResponse {
  const { indicators, chainResponse, technicals, professional, request } = input;
  const spot = chainResponse.spot || indicators.spot;
  const lotSize = request.riskParams.lotSize ?? 75;
  const threshold = request.riskParams.confidenceThreshold ?? 50;

  const enrichedIndicators: MarketIndicators = {
    ...indicators,
    pcr: chainResponse.pcr || indicators.pcr,
  };

  const chainDerived: ChainDerived = {
    atmStrike: chainResponse.atmStrike,
    maxCallOI: {
      strike: chainResponse.maxCallOIStrike,
      oi:
        chainResponse.chain.find((s) => s.strike === chainResponse.maxCallOIStrike)
          ?.ce.oi ?? 0,
    },
    maxPutOI: {
      strike: chainResponse.maxPutOIStrike,
      oi:
        chainResponse.chain.find((s) => s.strike === chainResponse.maxPutOIStrike)
          ?.pe.oi ?? 0,
    },
    maxPain: professional.chain?.maxPain ?? computeMaxPain(chainResponse.chain),
    pcrOI: professional.chain?.pcrOI ?? chainResponse.pcr,
    pcrVolume: professional.chain?.pcrVolume ?? 0,
    ivSkewATM: professional.chain?.ivSkewATM ?? 0,
    atmStraddle: 0,
    expectedMovePts: 0,
  };

  const ctx: StrategyEvalContext = {
    spot,
    indicators: enrichedIndicators,
    technicals,
    professional,
    chain: chainResponse,
    chainDerived,
  };

  const strategiesToScan =
    request.strategies && request.strategies.length > 0
      ? request.strategies
      : ALL_STRATEGIES;

  const suggestions: TradeSuggestion[] = [];

  for (const stratType of strategiesToScan) {
    const def = STRATEGY_RULES[stratType];
    if (!def) continue;

    const evalResult = evaluateStrategyRules(def, ctx);

    const strikeVariations = selectStrikes(
      stratType,
      spot,
      chainResponse.chain,
      enrichedIndicators.trend,
      lotSize,
    );
    if (strikeVariations.length === 0) continue;

    for (const selection of strikeVariations) {
      const sellStrikes = selection.legs
        .filter((l) => l.type.startsWith("SELL"))
        .map((l) => l.strike);
      const buyStrikes = selection.legs
        .filter((l) => l.type.startsWith("BUY"))
        .map((l) => l.strike);

      const scoringResult = scoreStrategy({
        strategy: stratType,
        chain: chainResponse.chain,
        indicators: enrichedIndicators,
        sellStrikes,
        buyStrikes,
        spot,
      });

      // Combine rule-engine match % with the scoring engine for a richer
      // confidence score — the rule engine is the floor, the scorer adds
      // chain + volume colour on top.
      const blended = Math.round(evalResult.matchPct * 0.55 + scoringResult.score * 0.45);
      if (blended < threshold) continue;

      const tier: ConfidenceTier =
        blended >= 75 ? "HIGH" : blended >= 55 ? "MEDIUM" : "LOW";

      const rr =
        selection.maxLoss !== 0
          ? Math.round((selection.maxProfit / Math.abs(selection.maxLoss)) * 100) / 100
          : selection.maxProfit > 0
            ? 99
            : 0;

      suggestions.push({
        id: generateId(),
        strategy: stratType,
        direction: selection.direction,
        legs: selection.legs,
        confidence: blended,
        confidenceTier: tier,
        expectedRiskReward: rr,
        maxProfit: selection.maxProfit,
        maxLoss: selection.maxLoss,
        breakeven: selection.breakeven,
        netPremium: selection.netPremium,
        rationale: [
          evalResult.headline,
          ...evalResult.rules.filter((r) => r.passed).map((r) => `✓ ${r.detail}`),
          ...scoringResult.reasons,
        ],
        entryConditions: evalResult.rules
          .filter((r) => r.passed)
          .map((r) => r.detail),
        exitRules: def.exitRules,
        marketContext: {
          spot,
          atm: Math.round(spot / 50) * 50,
          vix: enrichedIndicators.vix,
          trend: enrichedIndicators.trend,
          pcr: enrichedIndicators.pcr,
          ivPercentile: enrichedIndicators.ivPercentile,
        },
        createdAt: new Date().toISOString(),
      });
    }
  }

  suggestions.sort((a, b) => {
    const aCredit = CREDIT_STRATEGIES.has(a.strategy) ? 1 : 0;
    const bCredit = CREDIT_STRATEGIES.has(b.strategy) ? 1 : 0;
    if (bCredit !== aCredit) return bCredit - aCredit;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    if (b.netPremium !== a.netPremium) return b.netPremium - a.netPremium;
    return 0;
  });

  const limited = limitSuggestions(suggestions, 3, 12);

  return {
    suggestions: limited,
    scannedAt: new Date().toISOString(),
    marketSnapshot: {
      spot,
      vix: enrichedIndicators.vix,
      trend: enrichedIndicators.trend,
      pcr: enrichedIndicators.pcr,
      ivPercentile: enrichedIndicators.ivPercentile,
    },
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateId(): string {
  return `ts_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function limitSuggestions(
  suggestions: TradeSuggestion[],
  maxPerStrategy: number,
  maxTotal: number,
): TradeSuggestion[] {
  const counts: Record<string, number> = {};
  const result: TradeSuggestion[] = [];
  for (const s of suggestions) {
    counts[s.strategy] = (counts[s.strategy] ?? 0) + 1;
    if (counts[s.strategy] <= maxPerStrategy) result.push(s);
    if (result.length >= maxTotal) break;
  }
  return result;
}
