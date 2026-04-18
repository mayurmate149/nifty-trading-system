/**
 * Market Data — In-Memory Cache
 *
 * Stores latest ticks, OI, and options chain data.
 * Provides fast reads for API routes and the auto-exit engine.
 */

import { MarketTick, OptionChainRow } from "@/types/market";

// Simple in-memory cache (replace with Redis for multi-instance)
const tickCache = new Map<string, MarketTick>();
const optionChainCache = new Map<string, OptionChainRow[]>();

export function updateTick(tick: MarketTick): void {
  tickCache.set(tick.symbol, tick);
}

export function getLatestTick(symbol: string): MarketTick | undefined {
  return tickCache.get(symbol);
}

export function updateOptionChain(key: string, rows: OptionChainRow[]): void {
  optionChainCache.set(key, rows);
}

export function getOptionChain(key: string): OptionChainRow[] | undefined {
  return optionChainCache.get(key);
}

export function clearCache(): void {
  tickCache.clear();
  optionChainCache.clear();
}
