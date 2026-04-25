import { getPositions, getMargin, computeMarginFromPositions } from "@/server/broker-proxy";

const credsShape = (session: { accessToken: string; clientCode: string }) => ({
  accessToken: session.accessToken,
  clientCode: session.clientCode,
});

/**
 * Response body shape for GET /api/v1/positions (reusable from snapshot).
 */
export async function getPositionsApiPayload(session: {
  accessToken: string;
  clientCode: string;
}) {
  const creds = credsShape(session);
  let positions: any[] = [];
  let margin = null;

  try {
    positions = await getPositions(creds);
  } catch (error: any) {
    console.error("[POSITIONS] Error fetching positions:", error.message);
  }

  try {
    margin = await getMargin(creds);
  } catch (error: any) {
    console.error("[POSITIONS] Error fetching margin:", error.message);
  }

  const computed = computeMarginFromPositions(positions);
  const hasBrokerMargin = margin && (margin.usedMargin > 0 || margin.netMargin > 0);

  if (!hasBrokerMargin && computed.marginRequired > 0) {
    margin = {
      availableMargin: 0,
      usedMargin: computed.marginRequired,
      netMargin: computed.marginRequired,
      marginUtilizedPct: 100,
    };
  }

  return {
    positions,
    margin,
    fundsBreakdown: computed.fundsBreakdown,
  };
}

/** Used margin for risk math (auto-exit) from broker margin or 0. */
export function usedMarginFromPayload(
  margin: { usedMargin?: number } | null,
): number {
  return margin?.usedMargin ?? 0;
}
