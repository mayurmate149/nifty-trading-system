/**
 * Strategy Definitions — Options SELLER First
 *
 * Entry and exit rules for each strategy type.
 * Seller strategies listed first (primary focus).
 */

// ─── SELLER strategies (primary) ────────────
export { ironCondorStrategy } from "./iron-condor";
export { creditSpreadStrategy } from "./credit-spread";
export { shortStraddleStrategy } from "./short-straddle";
export { shortStrangleStrategy } from "./short-strangle";
export { scalpSellStrategy } from "./scalp-sell";

// ─── BUYER strategies (only extreme conditions) ─
export { debitSpreadStrategy } from "./debit-spread";
export { directionalBuyStrategy } from "./directional-buy";
