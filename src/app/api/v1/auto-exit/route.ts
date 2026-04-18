import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/server/middleware/auth";
import { getPositions, getMargin } from "@/server/broker-proxy";
import {
  startEngine,
  stopEngine,
  exitAllNow,
  watchAllPositions,
  unwatchAll,
  getWatchedPositions,
  isEngineRunning,
  computeRiskSummary,
  getPortfolioState,
} from "@/server/risk/auto-exit-engine";

/**
 * POST /api/v1/auto-exit
 *
 * Body: { action: "enable" | "disable", config?: { stopLossPercent, trailOffsetPercent, profitFloorPercent } }
 *
 * "enable"  → starts engine, watches all open positions
 * "disable" → stops engine, unwatches all
 */
export async function POST(request: NextRequest) {
  return withAuth(request, async (req, session) => {
    const body = await req.json();
    const action = body.action as string;

    if (action === "enable") {
      const config = body.config || {};

      // Start the engine with user's session credentials + config
      // Engine runs server-side and keeps running even if browser is closed
      startEngine(
        {
          accessToken: session.accessToken,
          clientCode: session.clientCode,
        },
        config
      );

      // Fetch current positions and watch them all
      const positions = await getPositions({
        accessToken: session.accessToken,
        clientCode: session.clientCode,
      });

      const watched = watchAllPositions(positions, config);

      return NextResponse.json({
        success: true,
        message: `Auto-exit enabled for ${watched.length} positions`,
        engine: true,
        watched: watched.length,
        config,
      });
    }

    if (action === "disable") {
      stopEngine();
      return NextResponse.json({
        success: true,
        message: "Auto-exit disabled",
        engine: false,
        watched: 0,
      });
    }

    if (action === "exit-all") {
      try {
        const result = await exitAllNow({
          accessToken: session.accessToken,
          clientCode: session.clientCode,
        });
        return NextResponse.json({
          success: true,
          message: `Exited ${result.succeeded}/${result.total} positions`,
          ...result,
        });
      } catch (err: any) {
        return NextResponse.json(
          { error: `Exit-all failed: ${err.message}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      { error: `Unknown action: ${action}. Use "enable", "disable", or "exit-all".` },
      { status: 400 }
    );
  });
}

/**
 * GET /api/v1/auto-exit
 *
 * Returns current engine status, watched positions, and risk summary.
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (_req, session) => {
    const running = isEngineRunning();
    const watched = getWatchedPositions();

    let riskSummary = null;
    if (running) {
      try {
        const creds = {
          accessToken: session.accessToken,
          clientCode: session.clientCode,
        };
        const positions = await getPositions(creds);
        let usedMargin = 0;
        try {
          const margin = await getMargin(creds);
          usedMargin = margin.usedMargin;
        } catch {
          // margin fetch failed, engine will use fallback
        }
        riskSummary = computeRiskSummary(positions, usedMargin);
      } catch {
        // If fetching positions fails, still return engine status
      }
    }

    return NextResponse.json({
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
    });
  });
}
