/**
 * Trade Suggestion Engine – Orchestrator
 *
 * Options SELLER focused.
 * Ties together: strategy entry checks → strike selection → scoring
 * Returns a ranked list of TradeSuggestion objects.
 *
 * Seller strategies (IC, Credit Spread, Short Straddle, Short Strangle, Scalp Sell)
 * are evaluated first and get a scoring bonus.
 * Buyer strategies (Debit Spread, Directional Buy) only shown in extreme conditions.
 */

import {
  StrategyType,
  TradeSuggestion,
  TradeDirection,
  ConfidenceTier,
  SuggestRequest,
  SuggestResponse,
  STRATEGY_META,
} from "@/types/strategy";
import { MarketIndicators, OptionChainStrike, OptionsChainResponse } from "@/types/market";
import { selectStrikes, StrikeSelection } from "./strike-selector";
import { scoreStrategy, ScoringResult } from "./scorer";

import { ironCondorStrategy } from "./strategies/iron-condor";
import { creditSpreadStrategy } from "./strategies/credit-spread";
import { shortStraddleStrategy } from "./strategies/short-straddle";
import { shortStrangleStrategy } from "./strategies/short-strangle";
import { scalpSellStrategy } from "./strategies/scalp-sell";
import { debitSpreadStrategy } from "./strategies/debit-spread";
import { directionalBuyStrategy } from "./strategies/directional-buy";

// ─── Strategy registry ──────────────────────

const STRATEGY_CHECKERS: Record<
  StrategyType,
  { checkEntry: (ind: MarketIndicators) => { suitable: boolean; reasons: string[] }; exitRules: Record<string, string> }
> = {
  IRON_CONDOR: ironCondorStrategy,
  CREDIT_SPREAD: creditSpreadStrategy,
  SHORT_STRADDLE: shortStraddleStrategy,
  SHORT_STRANGLE: shortStrangleStrategy,
  SCALP_SELL: scalpSellStrategy,
  DEBIT_SPREAD: debitSpreadStrategy,
  DIRECTIONAL_BUY: directionalBuyStrategy,
};

/** Seller strategies first — these are the primary focus */
const ALL_STRATEGIES: StrategyType[] = [
  "IRON_CONDOR",
  "CREDIT_SPREAD",
  "SHORT_STRADDLE",
  "SHORT_STRANGLE",
  "SCALP_SELL",
  "DEBIT_SPREAD",
  "DIRECTIONAL_BUY",
];

const SELLER_STRATEGIES = new Set<StrategyType>([
  "IRON_CONDOR",
  "CREDIT_SPREAD",
  "SHORT_STRADDLE",
  "SHORT_STRANGLE",
  "SCALP_SELL",
]);

// ─── Main Engine ─────────────────────────────

export interface EngineInput {
  indicators: MarketIndicators;
  chainResponse: OptionsChainResponse;
  request: SuggestRequest;
}

export function generateSuggestions(input: EngineInput): SuggestResponse {
  const { indicators, chainResponse, request } = input;
  const chain = chainResponse.chain;
  const spot = chainResponse.spot || indicators.spot;
  const lotSize = request.riskParams.lotSize ?? 75;
  const threshold = request.riskParams.confidenceThreshold ?? 50;

  // Enrich indicators with PCR from chain if missing
  const enrichedIndicators: MarketIndicators = {
    ...indicators,
    pcr: chainResponse.pcr || indicators.pcr,
  };

  // Determine which strategies to evaluate
  const strategiesToScan =
    request.strategies && request.strategies.length > 0
      ? request.strategies
      : ALL_STRATEGIES;

  const suggestions: TradeSuggestion[] = [];

  for (const stratType of strategiesToScan) {
    const checker = STRATEGY_CHECKERS[stratType];
    if (!checker) continue;

    // 1. Check entry conditions
    const entryCheck = checker.checkEntry(enrichedIndicators);

    // 2. Select strikes (may return multiple variations)
    const strikeVariations = selectStrikes(
      stratType,
      spot,
      chain,
      enrichedIndicators.trend,
      lotSize,
    );

    if (strikeVariations.length === 0) continue;

    // 3. Score each variation
    for (const selection of strikeVariations) {
      const sellStrikes = selection.legs
        .filter((l) => l.type.startsWith("SELL"))
        .map((l) => l.strike);
      const buyStrikes = selection.legs
        .filter((l) => l.type.startsWith("BUY"))
        .map((l) => l.strike);

      const scoringResult = scoreStrategy({
        strategy: stratType,
        chain,
        indicators: enrichedIndicators,
        sellStrikes,
        buyStrikes,
        spot,
      });

      // 4. Build suggestion even if entry not ideal
      //    (let score determine if it's worth showing)
      const combinedScore = entryCheck.suitable
        ? scoringResult.score
        : Math.max(0, scoringResult.score - 15); // penalize unsuitable entries

      const tier: ConfidenceTier =
        combinedScore >= 75 ? "HIGH" : combinedScore >= 55 ? "MEDIUM" : "LOW";

      if (combinedScore < threshold) continue;

      const meta = STRATEGY_META[stratType];
      const rr =
        selection.maxLoss !== 0
          ? Math.round((selection.maxProfit / Math.abs(selection.maxLoss)) * 100) / 100
          : selection.maxProfit > 0
          ? 99
          : 0;

      const suggestion: TradeSuggestion = {
        id: generateId(),
        strategy: stratType,
        direction: selection.direction,
        legs: selection.legs,
        confidence: combinedScore,
        confidenceTier: tier,
        expectedRiskReward: rr,
        maxProfit: selection.maxProfit,
        maxLoss: selection.maxLoss,
        breakeven: selection.breakeven,
        netPremium: selection.netPremium,
        rationale: [
          ...entryCheck.reasons,
          ...scoringResult.reasons,
        ],
        entryConditions: entryCheck.reasons,
        exitRules: checker.exitRules as TradeSuggestion["exitRules"],
        marketContext: {
          spot,
          atm: Math.round(spot / 50) * 50,
          vix: enrichedIndicators.vix,
          trend: enrichedIndicators.trend,
          pcr: enrichedIndicators.pcr,
          ivPercentile: enrichedIndicators.ivPercentile,
        },
        createdAt: new Date().toISOString(),
      };

      suggestions.push(suggestion);
    }
  }

  // Sort: seller strategies first, then by confidence, then by R:R
  suggestions.sort((a, b) => {
    // Seller vs buyer priority
    const aIsSeller = SELLER_STRATEGIES.has(a.strategy) ? 1 : 0;
    const bIsSeller = SELLER_STRATEGIES.has(b.strategy) ? 1 : 0;
    if (bIsSeller !== aIsSeller) return bIsSeller - aIsSeller;

    // Then by confidence
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;

    // Then by net credit (more premium collected = better)
    if (b.netPremium !== a.netPremium) return b.netPremium - a.netPremium;

    return 0;
  });

  // Limit to top suggestions (max 3 per strategy, max 12 total)
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

// ─── Helpers ─────────────────────────────────

function generateId(): string {
  // Simple unique ID without external uuid dependency
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
    const key = s.strategy;
    counts[key] = (counts[key] ?? 0) + 1;
    if (counts[key] <= maxPerStrategy) {
      result.push(s);
    }
    if (result.length >= maxTotal) break;
  }

  return result;
}
