/**
 * Strategy Registry — 8 rule-based strategies.
 *
 * Each strategy exports a typed StrategyRules object whose `rules` array is
 * evaluated by the rule engine against a shared StrategyEvalContext built
 * from live market indicators, technicals, and option-chain data.
 */

export { bullCallSpreadRules } from "./bull-call-spread";
export { bullPutSpreadRules } from "./bull-put-spread";
export { bearPutSpreadRules } from "./bear-put-spread";
export { bearCallSpreadRules } from "./bear-call-spread";
export { ironFlyRules } from "./iron-fly";
export { shortIronCondorRules } from "./short-iron-condor";
export { directionalBuyRules } from "./directional-buy";
export { nakedBuyRules } from "./naked-buy";

import { bullCallSpreadRules } from "./bull-call-spread";
import { bullPutSpreadRules } from "./bull-put-spread";
import { bearPutSpreadRules } from "./bear-put-spread";
import { bearCallSpreadRules } from "./bear-call-spread";
import { ironFlyRules } from "./iron-fly";
import { shortIronCondorRules } from "./short-iron-condor";
import { directionalBuyRules } from "./directional-buy";
import { nakedBuyRules } from "./naked-buy";
import type { StrategyRules } from "../strategy-rules/types";

/** Canonical ordered list used by the Pro Trader desk and API. */
export const ALL_STRATEGY_RULES: StrategyRules[] = [
  bullCallSpreadRules,
  bullPutSpreadRules,
  bearPutSpreadRules,
  bearCallSpreadRules,
  ironFlyRules,
  shortIronCondorRules,
  directionalBuyRules,
  nakedBuyRules,
];
