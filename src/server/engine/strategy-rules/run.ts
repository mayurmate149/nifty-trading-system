/**
 * Strategy rule runner.
 *
 * Evaluates every rule against the shared context and aggregates the results
 * into:
 *   - per-rule pass/fail + detail
 *   - per-group pass count / total (used in the UI to show trend/momentum etc)
 *   - weighted match percentage (weighted by rule weights)
 *   - overall readiness: READY / ARMED / WAIT / AVOID
 */

import type {
  Rule,
  RuleGroup,
  StrategyEvalContext,
  StrategyRules,
} from "./types";

export type Readiness = "READY" | "ARMED" | "WAIT" | "AVOID";

export interface EvaluatedRule {
  id: string;
  group: RuleGroup;
  label: string;
  weight: 1 | 2 | 3;
  critical: boolean;
  passed: boolean;
  detail: string;
}

export interface GroupSummary {
  group: RuleGroup;
  passed: number;
  total: number;
  weightPassed: number;
  weightTotal: number;
}

export interface EvaluatedStrategy {
  key: StrategyRules["key"];
  matchPct: number;
  readiness: Readiness;
  headline: string;
  rules: EvaluatedRule[];
  groups: GroupSummary[];
  criticalsFailed: EvaluatedRule[];
}

const GROUP_ORDER: RuleGroup[] = [
  "trend",
  "momentum",
  "volatility",
  "option_chain",
  "structure",
  "volume",
];

export function evaluateStrategyRules(
  def: StrategyRules,
  ctx: StrategyEvalContext,
): EvaluatedStrategy {
  const evaluated: EvaluatedRule[] = def.rules.map((rule) => {
    const { passed, detail } = runRuleSafely(rule, ctx);
    return {
      id: rule.id,
      group: rule.group,
      label: rule.label,
      weight: rule.weight,
      critical: rule.critical,
      passed,
      detail,
    };
  });

  const weightTotal = evaluated.reduce((sum, r) => sum + r.weight, 0);
  const weightPassed = evaluated
    .filter((r) => r.passed)
    .reduce((sum, r) => sum + r.weight, 0);
  const matchPct =
    weightTotal > 0 ? Math.round((weightPassed / weightTotal) * 100) : 0;

  const criticalsFailed = evaluated.filter((r) => r.critical && !r.passed);

  // Readiness machine — critical first, then weighted thresholds.
  // Keep thresholds realistic so READY is reachable when the core edge lines
  // up; non-critical weighted rules then decide READY vs ARMED.
  let readiness: Readiness;
  if (criticalsFailed.length > 0 || matchPct < 30) {
    readiness = "AVOID";
  } else if (matchPct >= 70) {
    readiness = "READY";
  } else if (matchPct >= 55) {
    readiness = "ARMED";
  } else {
    readiness = "WAIT";
  }

  const groups = buildGroupSummaries(evaluated);
  const headline = deriveHeadline(readiness, criticalsFailed, evaluated);

  return {
    key: def.key,
    matchPct,
    readiness,
    headline,
    rules: evaluated,
    groups,
    criticalsFailed,
  };
}

function runRuleSafely(
  rule: Rule,
  ctx: StrategyEvalContext,
): { passed: boolean; detail: string } {
  try {
    return rule.evaluate(ctx);
  } catch (err: any) {
    return { passed: false, detail: `Rule error: ${err?.message ?? "unknown"}` };
  }
}

function buildGroupSummaries(rules: EvaluatedRule[]): GroupSummary[] {
  const map = new Map<RuleGroup, GroupSummary>();
  for (const g of GROUP_ORDER) {
    map.set(g, { group: g, passed: 0, total: 0, weightPassed: 0, weightTotal: 0 });
  }
  for (const r of rules) {
    const s = map.get(r.group);
    if (!s) continue;
    s.total += 1;
    s.weightTotal += r.weight;
    if (r.passed) {
      s.passed += 1;
      s.weightPassed += r.weight;
    }
  }
  return Array.from(map.values()).filter((s) => s.total > 0);
}

function deriveHeadline(
  readiness: Readiness,
  criticalsFailed: EvaluatedRule[],
  rules: EvaluatedRule[],
): string {
  if (criticalsFailed.length > 0) return criticalsFailed[0].detail;
  if (readiness === "READY") {
    // Pick the strongest reason among passed rules
    const topReason = rules.find((r) => r.passed && r.weight === 3);
    return topReason?.detail ?? "All critical rules aligned.";
  }
  const firstFailing = rules.find((r) => !r.passed);
  if (firstFailing) return firstFailing.detail;
  return readiness === "ARMED" ? "Most rules aligning" : "Monitoring";
}
