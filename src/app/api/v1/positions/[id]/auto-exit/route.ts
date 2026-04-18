import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/server/middleware/auth";
import { startWatching, stopWatching, getWatchedPosition } from "@/server/risk/auto-exit-engine";

/**
 * POST /api/v1/positions/:id/auto-exit
 *
 * Enable or disable auto-exit monitoring for a SINGLE position.
 * Body: { mode: "ENABLE" | "DISABLE", stopLossPercent?, trailOffsetPercent?, profitFloorPercent? }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  return withAuth(request, async (_req, _session) => {
    const body = await request.json();
    const positionId = params.id;

    if (body.mode === "ENABLE") {
      const state = startWatching(positionId, {
        stopLossPercent: body.stopLossPercent ?? 1.0,
        trailOffsetPercent: body.trailOffsetPercent ?? 1.0,
        profitFloorPercent: body.profitFloorPercent ?? 2.0,
      });

      return NextResponse.json({
        success: true,
        message: "Auto-exit enabled",
        watchId: state.watchId,
      });
    } else {
      stopWatching(positionId);
      return NextResponse.json({
        success: true,
        message: "Auto-exit disabled",
      });
    }
  });
}

/**
 * GET /api/v1/positions/:id/auto-exit
 *
 * Get the auto-exit watch state for a single position.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  return withAuth(request, async (_req, _session) => {
    const state = getWatchedPosition(params.id);
    return NextResponse.json({
      watched: !!state,
      state: state
        ? {
            positionId: state.positionId,
            active: state.active,
            currentSLPercent: state.currentSLPercent,
            peakProfitPercent: state.peakProfitPercent,
            config: state.config,
          }
        : null,
    });
  });
}
