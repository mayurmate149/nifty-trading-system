import { getPositions, getMargin } from "@/server/broker-proxy";
import {
  isEngineRunning,
  getWatchedPositions,
  computeRiskSummary,
  getPortfolioState,
} from "@/server/risk/auto-exit-engine";

const credsShape = (session: { accessToken: string; clientCode: string }) => ({
  accessToken: session.accessToken,
  clientCode: session.clientCode,
});

export type AutoExitView = {
  engine: boolean;
  watched: {
    positionId: string;
    active: boolean;
    currentSLPercent: number;
    peakProfitPercent: number;
    config: unknown;
  }[];
  riskSummary: unknown;
  portfolio: ReturnType<typeof getPortfolioState>;
};

/**
 * GET /api/v1/auto-exit body. If `preloaded` is passed (from snapshot), skips extra getPositions/getMargin.
 */
export async function getAutoExitApiPayload(
  session: { accessToken: string; clientCode: string },
  preloaded?: { positions: any[]; usedMargin: number },
): Promise<AutoExitView> {
  const creds = credsShape(session);
  const running = isEngineRunning();
  const watched = getWatchedPositions();

  let riskSummary = null;
  if (running) {
    try {
      let positions = preloaded?.positions;
      let usedMargin = preloaded?.usedMargin ?? 0;
      if (!positions) {
        positions = await getPositions(creds);
        try {
          const margin = await getMargin(creds);
          usedMargin = margin.usedMargin;
        } catch {
          // use 0
        }
      }
      riskSummary = computeRiskSummary(positions, usedMargin);
    } catch {
      // If fetching positions fails, still return engine status
    }
  }

  return {
    engine: running,
    watched: watched.map((w) => ({
      positionId: w.positionId,
      active: w.active,
      currentSLPercent: w.currentSLPercent,
      peakProfitPercent: w.peakProfitPercent,
      config: w.config,
    })),
    riskSummary,
    portfolio: getPortfolioState(),
  };
}
