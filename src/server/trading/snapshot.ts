import type { AuthSession } from "@/types/auth";
import { getAutoExitApiPayload } from "./auto-exit-payload";
import { getMarketIndicatorsForSession } from "./market-indicators";
import { getPositionsApiPayload, usedMarginFromPayload } from "./positions-payload";

/**
 * One round-trip for the positions page: positions + auto-exit + indicators.
 * Reuses a single getPositions() result for auto-exit risk when the engine is running
 * (avoids duplicate broker calls on /auto-exit + /positions when polled separately).
 */
export async function buildTradingPageSnapshot(session: AuthSession) {
  const positions = await getPositionsApiPayload(session);
  const used = usedMarginFromPayload(positions.margin);
  const [autoExit, indicators] = await Promise.all([
    getAutoExitApiPayload(session, {
      positions: positions.positions,
      usedMargin: used,
    }),
    getMarketIndicatorsForSession(session),
  ]);
  return { positions, autoExit, indicators };
}
