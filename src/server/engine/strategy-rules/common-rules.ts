/**
 * Shared rule builders — professional technical + option-chain predicates.
 *
 * These are the atomic "proven technicals" each strategy composes from. Every
 * helper returns a Rule factory that closes over its parameters so strategy
 * files can read like a checklist instead of restating formulae.
 */

import type { Rule, RuleGroup, RuleWeight } from "./types";

function rule(
  id: string,
  group: RuleGroup,
  label: string,
  weight: RuleWeight,
  critical: boolean,
  evaluate: Rule["evaluate"],
): Rule {
  return { id, group, label, weight, critical, evaluate };
}

// ─── TREND RULES ────────────────────────────────────────────────────────────

export function emaCrossoverRule(
  bias: "BULLISH" | "BEARISH" | "NEUTRAL",
  weight: RuleWeight = 3,
  critical = true,
): Rule {
  return rule("ema_crossover", "trend", `EMA 9/21 ${bias.toLowerCase()}`, weight, critical, (ctx) => {
    const t = ctx.technicals;
    const passed = t.emaCrossover === bias;
    const detail = passed
      ? `EMA9 ${t.ema9} ${t.emaCrossover === "BULLISH" ? ">" : t.emaCrossover === "BEARISH" ? "<" : "≈"} EMA21 ${t.ema21}`
      : `EMA stack ${t.emaCrossover.toLowerCase()} — needs ${bias.toLowerCase()}`;
    return { passed, detail };
  });
}

export function superTrendRule(
  bias: "BUY" | "SELL",
  weight: RuleWeight = 2,
  critical = false,
): Rule {
  return rule("supertrend", "trend", `SuperTrend ${bias === "BUY" ? "bullish" : "bearish"}`, weight, critical, (ctx) => {
    const passed = ctx.technicals.superTrendSignal === bias;
    const detail = passed
      ? `SuperTrend ${bias} at ${ctx.technicals.superTrend}`
      : `SuperTrend ${ctx.technicals.superTrendSignal} — opposite to desired ${bias}`;
    return { passed, detail };
  });
}

export function indicatorTrendRule(
  allowed: Array<"trend-up" | "trend-down" | "range-bound">,
  minStrength: number,
  weight: RuleWeight = 3,
  critical = true,
): Rule {
  return rule("market_regime", "trend", `Regime ${allowed.join(" / ")}`, weight, critical, (ctx) => {
    const t = ctx.indicators.trend;
    const s = ctx.indicators.trendStrength;
    const trendOk = allowed.includes(t);
    const strengthOk = minStrength === 0 ? true : s >= minStrength;
    const passed = trendOk && strengthOk;
    const detail = !trendOk
      ? `Market is ${t} — strategy needs ${allowed.join(" / ")}`
      : !strengthOk
        ? `Trend strength ${s} < required ${minStrength}`
        : `Regime ${t} · strength ${s}`;
    return { passed, detail };
  });
}

export function bollingerExpansionRule(
  minWidthPct: number,
  weight: RuleWeight = 2,
): Rule {
  return rule("bb_expansion", "trend", `Bollinger width ≥ ${minWidthPct}%`, weight, false, (ctx) => {
    const b = ctx.professional.bollinger;
    if (!b) return { passed: false, detail: "Bollinger data unavailable" };
    const passed = b.widthPct >= minWidthPct;
    return {
      passed,
      detail: passed
        ? `BB width ${b.widthPct}% — room for a move`
        : `BB width ${b.widthPct}% < ${minWidthPct}% — squeezed range`,
    };
  });
}

export function bollingerSqueezeRule(
  maxWidthPct: number,
  weight: RuleWeight = 2,
): Rule {
  return rule("bb_squeeze", "trend", `Bollinger width ≤ ${maxWidthPct}% (compression)`, weight, false, (ctx) => {
    const b = ctx.professional.bollinger;
    if (!b) return { passed: false, detail: "Bollinger data unavailable" };
    const passed = b.widthPct <= maxWidthPct;
    return {
      passed,
      detail: passed
        ? `BB width ${b.widthPct}% ≤ ${maxWidthPct}% — compression favors theta`
        : `BB width ${b.widthPct}% > ${maxWidthPct}% — too wide for pin`,
    };
  });
}

// ─── MOMENTUM RULES ─────────────────────────────────────────────────────────

export function rsiBetweenRule(
  lo: number,
  hi: number,
  weight: RuleWeight = 2,
  critical = false,
): Rule {
  return rule("rsi_band", "momentum", `RSI in ${lo}-${hi}`, weight, critical, (ctx) => {
    const v = ctx.technicals.rsi;
    const passed = v >= lo && v <= hi;
    return {
      passed,
      detail: passed
        ? `RSI ${v} in ${lo}-${hi}`
        : v < lo
          ? `RSI ${v} oversold vs ${lo}`
          : `RSI ${v} overbought vs ${hi}`,
    };
  });
}

export function macdBiasRule(
  expected: "BULLISH" | "BEARISH" | "NEUTRAL",
  weight: RuleWeight = 2,
  critical = false,
): Rule {
  return rule("macd_bias", "momentum", `MACD ${expected.toLowerCase()}`, weight, critical, (ctx) => {
    const m = ctx.professional.macd;
    if (!m) return { passed: false, detail: "MACD unavailable (need 35+ bars)" };
    const passed = m.bias === expected;
    return {
      passed,
      detail: passed
        ? `MACD hist ${m.histogram} ${m.bias.toLowerCase()}`
        : `MACD hist ${m.histogram} (${m.bias.toLowerCase()}) — want ${expected.toLowerCase()}`,
    };
  });
}

export function vwapPositionRule(
  expected: "ABOVE" | "BELOW",
  weight: RuleWeight = 2,
  critical = false,
): Rule {
  return rule("vwap_pos", "momentum", `Price ${expected.toLowerCase()} VWAP`, weight, critical, (ctx) => {
    const t = ctx.technicals;
    const passed = t.priceVsVwap === expected;
    return {
      passed,
      detail: passed
        ? `Close ${t.close} ${expected === "ABOVE" ? ">" : "<"} VWAP ${t.vwap}`
        : `Close ${t.close} ${t.priceVsVwap.toLowerCase()} VWAP ${t.vwap}`,
    };
  });
}

export function stochasticZoneRule(
  expected: "OVERBOUGHT" | "OVERSOLD" | "NEUTRAL",
  weight: RuleWeight = 1,
): Rule {
  return rule("stoch_zone", "momentum", `Stochastic ${expected.toLowerCase()}`, weight, false, (ctx) => {
    const s = ctx.professional.stochastic;
    if (!s) return { passed: false, detail: "Stochastic unavailable" };
    const passed = s.zone === expected;
    return {
      passed,
      detail: passed
        ? `Stoch k=${s.k}, d=${s.d} (${s.zone.toLowerCase()})`
        : `Stoch k=${s.k} (${s.zone.toLowerCase()}) — want ${expected.toLowerCase()}`,
    };
  });
}

export function momentumMinRule(
  minPct: number,
  direction: "UP" | "DOWN",
  weight: RuleWeight = 2,
): Rule {
  return rule("momentum_roc", "momentum", `5-bar ROC ${direction === "UP" ? "≥" : "≤"} ${minPct}%`, weight, false, (ctx) => {
    const m = ctx.technicals.momentum;
    const passed = direction === "UP" ? m >= minPct : m <= -Math.abs(minPct);
    return {
      passed,
      detail: passed
        ? `Momentum ${m}% confirms ${direction === "UP" ? "upward" : "downward"} drift`
        : `Momentum ${m}% — insufficient ${direction === "UP" ? "upside" : "downside"} drift`,
    };
  });
}

// ─── VOLATILITY RULES ───────────────────────────────────────────────────────

export function ivPercentileRule(
  lo: number,
  hi: number,
  weight: RuleWeight = 3,
  critical = true,
): Rule {
  return rule("iv_pct", "volatility", `IV %ile ${lo}-${hi}`, weight, critical, (ctx) => {
    const v = ctx.indicators.ivPercentile;
    const passed = v >= lo && v <= hi;
    return {
      passed,
      detail: passed
        ? `IV %ile ${v} in ${lo}-${hi}`
        : v < lo
          ? `IV %ile ${v} < ${lo} — ${lo >= 30 ? "premiums too thin to sell" : "cheap to buy"}`
          : `IV %ile ${v} > ${hi} — ${hi <= 50 ? "expensive to buy" : "fine to sell but watch IV crush"}`,
    };
  });
}

export function vixBetweenRule(
  lo: number,
  hi: number,
  weight: RuleWeight = 1,
): Rule {
  return rule("vix_band", "volatility", `VIX in ${lo}-${hi}`, weight, false, (ctx) => {
    const v = ctx.indicators.vix;
    const passed = v >= lo && v <= hi;
    return {
      passed,
      detail: passed
        ? `VIX ${v.toFixed(1)} in ${lo}-${hi}`
        : `VIX ${v.toFixed(1)} outside ${lo}-${hi}`,
    };
  });
}

// ─── OPTION CHAIN RULES ─────────────────────────────────────────────────────

export function pcrBetweenRule(
  lo: number,
  hi: number,
  weight: RuleWeight = 2,
): Rule {
  return rule("pcr_band", "option_chain", `PCR in ${lo}-${hi}`, weight, false, (ctx) => {
    const v = ctx.chainDerived.pcrOI;
    const passed = v >= lo && v <= hi;
    return {
      passed,
      detail: passed
        ? `PCR(OI) ${v.toFixed(2)} in ${lo}-${hi}`
        : v < lo
          ? `PCR ${v.toFixed(2)} < ${lo} — bearish skew`
          : `PCR ${v.toFixed(2)} > ${hi} — bullish skew`,
    };
  });
}

export function maxPainRelativeToSpot(
  expected: "AT_SPOT" | "ABOVE_SPOT" | "BELOW_SPOT",
  toleranceRatio = 0.004,
  weight: RuleWeight = 1,
): Rule {
  return rule(
    "max_pain",
    "option_chain",
    `Max pain ${expected === "AT_SPOT" ? "near" : expected.replace("_SPOT", "").toLowerCase()} spot`,
    weight,
    false,
    (ctx) => {
      const mp = ctx.chainDerived.maxPain;
      const spot = ctx.spot;
      if (!mp) return { passed: false, detail: "Max pain unavailable" };
      const diff = mp - spot;
      const tol = spot * toleranceRatio;
      let passed = false;
      if (expected === "AT_SPOT") passed = Math.abs(diff) <= tol;
      else if (expected === "ABOVE_SPOT") passed = diff > tol;
      else passed = diff < -tol;
      return {
        passed,
        detail: passed
          ? `Max pain ${mp} ${expected === "AT_SPOT" ? "≈" : expected === "ABOVE_SPOT" ? ">" : "<"} spot ${spot.toFixed(0)}`
          : `Max pain ${mp} vs spot ${spot.toFixed(0)} — not ${expected.toLowerCase()}`,
      };
    },
  );
}

export function oiFlowRule(
  side: "call" | "put",
  expected: "BUILDUP" | "UNWIND" | "MIXED",
  weight: RuleWeight = 2,
): Rule {
  return rule(
    `oi_flow_${side}`,
    "option_chain",
    `${side.toUpperCase()} OI ${expected.toLowerCase()}`,
    weight,
    false,
    (ctx) => {
      const oi = ctx.professional.oiInsights;
      if (!oi) return { passed: false, detail: "OI insights unavailable" };
      const flow = side === "call" ? oi.callFlow : oi.putFlow;
      const net = side === "call" ? oi.netCallOiChange : oi.netPutOiChange;
      const passed = flow === expected;
      return {
        passed,
        detail: passed
          ? `${side === "call" ? "CE" : "PE"} net ΔOI ${formatOi(net)} — ${flow.toLowerCase()}`
          : `${side === "call" ? "CE" : "PE"} net ΔOI ${formatOi(net)} — flow ${flow.toLowerCase()}, want ${expected.toLowerCase()}`,
      };
    },
  );
}

export function hasWallRule(
  side: "call" | "put",
  expectedBeyondSpot: "ABOVE" | "BELOW",
  weight: RuleWeight = 2,
): Rule {
  return rule(
    `wall_${side}`,
    "option_chain",
    `${side === "call" ? "Call" : "Put"} OI wall ${expectedBeyondSpot.toLowerCase()} spot`,
    weight,
    false,
    (ctx) => {
      const wall = side === "call" ? ctx.chainDerived.maxCallOI : ctx.chainDerived.maxPutOI;
      const spot = ctx.spot;
      const diff = wall.strike - spot;
      const passed =
        (expectedBeyondSpot === "ABOVE" && diff > 0) ||
        (expectedBeyondSpot === "BELOW" && diff < 0);
      return {
        passed,
        detail: passed
          ? `Max ${side.toUpperCase()} OI at ${wall.strike} ${expectedBeyondSpot === "ABOVE" ? "above" : "below"} spot ${spot.toFixed(0)}`
          : `Max ${side.toUpperCase()} OI at ${wall.strike} — not ${expectedBeyondSpot.toLowerCase()} spot`,
      };
    },
  );
}

// ─── STRUCTURE RULES ────────────────────────────────────────────────────────

export function dteBetweenRule(
  lo: number,
  hi: number,
  weight: RuleWeight = 1,
  critical = false,
): Rule {
  return rule("dte_band", "structure", `DTE in ${lo}-${hi}`, weight, critical, (ctx) => {
    const d = ctx.indicators.daysToExpiry;
    const passed = d >= lo && d <= hi;
    return {
      passed,
      detail: passed
        ? `${d} DTE in ${lo}-${hi}`
        : d < lo
          ? `${d} DTE < ${lo} — gamma / time risk`
          : `${d} DTE > ${hi} — theta too slow`,
    };
  });
}

export function spotVsLevelRule(
  level: "support" | "resistance" | "pivot",
  relation: "ABOVE" | "BELOW" | "NEAR",
  proximityPts = 60,
  weight: RuleWeight = 1,
): Rule {
  return rule(
    `spot_${level}_${relation.toLowerCase()}`,
    "structure",
    `Spot ${relation.toLowerCase()} nearest ${level}`,
    weight,
    false,
    (ctx) => {
      const s = ctx.spot;
      const levels =
        level === "support"
          ? ctx.indicators.support
          : level === "resistance"
            ? ctx.indicators.resistance
            : ctx.indicators.pivotPoint
              ? [ctx.indicators.pivotPoint]
              : [];
      if (!levels.length) return { passed: false, detail: `No ${level} levels available` };
      const nearest = levels.reduce(
        (best, v) => (Math.abs(v - s) < Math.abs(best - s) ? v : best),
        levels[0],
      );
      const diff = s - nearest;
      let passed = false;
      if (relation === "ABOVE") passed = diff > 0;
      else if (relation === "BELOW") passed = diff < 0;
      else passed = Math.abs(diff) <= proximityPts;
      return {
        passed,
        detail: passed
          ? `Spot ${s.toFixed(0)} ${relation === "NEAR" ? `within ${proximityPts}pt of` : relation === "ABOVE" ? ">" : "<"} ${level} ${nearest}`
          : `Spot ${s.toFixed(0)} vs ${level} ${nearest} — not ${relation.toLowerCase()}`,
      };
    },
  );
}

// ─── DIRECTION-AGNOSTIC (trend-aligned) RULES ──────────────────────────────
// For strategies (Directional Buy, Naked Buy) whose side is resolved at
// strike-selection time from the live market regime. Each rule passes when
// the indicator points the same way as the detected trend.

function trendSign(trend: string): 1 | -1 | 0 {
  if (trend === "trend-up") return 1;
  if (trend === "trend-down") return -1;
  return 0;
}

export function directionalTrendRule(
  minStrength = 55,
  weight: RuleWeight = 3,
  critical = true,
): Rule {
  return rule(
    "directional_trend",
    "trend",
    `Trend directional & strong (≥ ${minStrength})`,
    weight,
    critical,
    (ctx) => {
      const t = ctx.indicators.trend;
      const s = ctx.indicators.trendStrength;
      const directional = t === "trend-up" || t === "trend-down";
      const passed = directional && s >= minStrength;
      return {
        passed,
        detail: !directional
          ? `Regime ${t} — no directional edge`
          : !passed
            ? `Trend ${t} strength ${s} < ${minStrength}`
            : `Trend ${t} · strength ${s} qualifies`,
      };
    },
  );
}

export function emaAlignsWithTrendRule(
  weight: RuleWeight = 3,
  critical = true,
): Rule {
  return rule("ema_aligns", "trend", "EMA 9/21 aligns with live trend", weight, critical, (ctx) => {
    const sign = trendSign(ctx.indicators.trend);
    if (sign === 0) return { passed: false, detail: "No directional trend" };
    const emaSign =
      ctx.technicals.emaCrossover === "BULLISH"
        ? 1
        : ctx.technicals.emaCrossover === "BEARISH"
          ? -1
          : 0;
    const passed = emaSign === sign;
    return {
      passed,
      detail: passed
        ? `EMA ${ctx.technicals.emaCrossover.toLowerCase()} with trend`
        : `EMA ${ctx.technicals.emaCrossover.toLowerCase()} disagrees with trend ${ctx.indicators.trend}`,
    };
  });
}

export function superTrendAlignsWithTrendRule(
  weight: RuleWeight = 3,
  critical = true,
): Rule {
  return rule("supertrend_aligns", "trend", "SuperTrend aligns with live trend", weight, critical, (ctx) => {
    const sign = trendSign(ctx.indicators.trend);
    if (sign === 0) return { passed: false, detail: "No directional trend" };
    const stSign = ctx.technicals.superTrendSignal === "BUY" ? 1 : -1;
    const passed = stSign === sign;
    return {
      passed,
      detail: passed
        ? `SuperTrend ${ctx.technicals.superTrendSignal} with trend`
        : `SuperTrend ${ctx.technicals.superTrendSignal} disagrees with trend ${ctx.indicators.trend}`,
    };
  });
}

export function rsiAlignsWithTrendRule(
  weight: RuleWeight = 2,
): Rule {
  return rule("rsi_aligns", "momentum", "RSI aligns with trend", weight, false, (ctx) => {
    const sign = trendSign(ctx.indicators.trend);
    if (sign === 0) return { passed: false, detail: "No directional trend" };
    const rsi = ctx.technicals.rsi;
    const passed = sign === 1 ? rsi >= 55 : rsi <= 45;
    return {
      passed,
      detail: passed
        ? `RSI ${rsi} supports ${ctx.indicators.trend}`
        : `RSI ${rsi} neutral/contra to ${ctx.indicators.trend}`,
    };
  });
}

export function macdAlignsWithTrendRule(weight: RuleWeight = 2): Rule {
  return rule("macd_aligns", "momentum", "MACD aligns with trend", weight, false, (ctx) => {
    const sign = trendSign(ctx.indicators.trend);
    const m = ctx.professional.macd;
    if (!m) return { passed: false, detail: "MACD unavailable" };
    if (sign === 0) return { passed: false, detail: "No directional trend" };
    const biasSign = m.bias === "BULLISH" ? 1 : m.bias === "BEARISH" ? -1 : 0;
    const passed = biasSign === sign;
    return {
      passed,
      detail: passed
        ? `MACD ${m.bias.toLowerCase()} (${m.histogram}) agrees with trend`
        : `MACD ${m.bias.toLowerCase()} vs trend ${ctx.indicators.trend}`,
    };
  });
}

export function vwapAlignsWithTrendRule(weight: RuleWeight = 2): Rule {
  return rule("vwap_aligns", "momentum", "Price vs VWAP aligns with trend", weight, false, (ctx) => {
    const sign = trendSign(ctx.indicators.trend);
    if (sign === 0) return { passed: false, detail: "No directional trend" };
    const pv = ctx.technicals.priceVsVwap;
    const passed = sign === 1 ? pv === "ABOVE" : pv === "BELOW";
    return {
      passed,
      detail: passed
        ? `Close ${pv.toLowerCase()} VWAP aligns with trend`
        : `Close ${pv.toLowerCase()} VWAP — contra to trend`,
    };
  });
}

export function momentumAlignsWithTrendRule(minAbsPct = 0.2, weight: RuleWeight = 2): Rule {
  return rule("momentum_aligns", "momentum", `ROC aligns with trend`, weight, false, (ctx) => {
    const sign = trendSign(ctx.indicators.trend);
    if (sign === 0) return { passed: false, detail: "No directional trend" };
    const m = ctx.technicals.momentum;
    const passed = sign === 1 ? m >= minAbsPct : m <= -minAbsPct;
    return {
      passed,
      detail: passed
        ? `ROC ${m}% matches ${ctx.indicators.trend}`
        : `ROC ${m}% — insufficient drift vs trend`,
    };
  });
}

// ─── VOLUME RULES ───────────────────────────────────────────────────────────

export function volumeSpikeRule(weight: RuleWeight = 1): Rule {
  return rule("vol_spike", "volume", "Volume spike (>1.5× avg)", weight, false, (ctx) => {
    const passed = ctx.technicals.volumeSpike;
    return {
      passed,
      detail: passed
        ? "Last bar volume > 1.5× 10-bar average"
        : "No volume spike on last bar",
    };
  });
}

export function candleDirectionRule(
  expected: "BULLISH" | "BEARISH",
  weight: RuleWeight = 1,
): Rule {
  return rule("candle_dir", "volume", `Last candle ${expected.toLowerCase()}`, weight, false, (ctx) => {
    const passed =
      expected === "BULLISH" ? ctx.technicals.lastCandleBullish : !ctx.technicals.lastCandleBullish;
    return {
      passed,
      detail: passed
        ? `Last candle is ${expected.toLowerCase()}`
        : `Last candle is ${ctx.technicals.lastCandleBullish ? "bullish" : "bearish"}`,
    };
  });
}

// ─── helpers ────────────────────────────────────────────────────────────────

function formatOi(n: number): string {
  const abs = Math.abs(n);
  const u =
    abs >= 1e7 ? `${(abs / 1e7).toFixed(1)}Cr`
    : abs >= 1e5 ? `${(abs / 1e5).toFixed(1)}L`
    : abs >= 1e3 ? `${(abs / 1e3).toFixed(0)}K`
    : `${abs}`;
  return n < 0 ? `−${u}` : u;
}
