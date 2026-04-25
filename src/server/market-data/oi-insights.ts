/**
 * OI build-up / concentration from options chain (per strike CE/PE).
 */

import type { OptionChainStrike } from "@/types/market";

export interface OiLegInsight {
  strike: number;
  oi: number;
  changeInOi: number;
  volume: number;
}

export type OiFlowBias = "BUILDUP" | "UNWIND" | "MIXED";

export interface OiInsights {
  topCallByOi: OiLegInsight[];
  topPutByOi: OiLegInsight[];
  topCallByOiChange: OiLegInsight[];
  topPutByOiChange: OiLegInsight[];
  netCallOiChange: number;
  netPutOiChange: number;
  callFlow: OiFlowBias;
  putFlow: OiFlowBias;
  /** One-line for desk copy */
  narrative: string;
}

const TOP = 5;
const CUTOFF = 50_000; // ignore tiny rest-of-chain noise in net (absolute sum units)

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toLeg(
  row: OptionChainStrike,
  side: "ce" | "pe",
): OiLegInsight {
  const leg = row[side];
  return {
    strike: row.strike,
    oi: leg.oi,
    changeInOi: leg.changeInOi,
    volume: leg.volume,
  };
}

function flowBias(net: number): OiFlowBias {
  if (net > CUTOFF) return "BUILDUP";
  if (net < -CUTOFF) return "UNWIND";
  return "MIXED";
}

function fmtOiChg(n: number): string {
  const x = Math.abs(n);
  let u: string;
  if (x >= 1e7) u = `${(x / 1e7).toFixed(1)} Cr`;
  else if (x >= 1e5) u = `${(x / 1e5).toFixed(1)} L`;
  else if (x >= 1e3) u = `${(x / 1e3).toFixed(0)} K`;
  else u = `${x}`;
  return n < 0 ? `−${u}` : u;
}

/**
 * Ranks strikes by OI and by OI change for CE/PE. Net change sums help infer fresh writing vs cover.
 */
export function computeOiInsights(strikes: OptionChainStrike[]): OiInsights | null {
  if (strikes.length === 0) return null;

  const callLegs: OiLegInsight[] = strikes.map((r) => toLeg(r, "ce"));
  const putLegs: OiLegInsight[] = strikes.map((r) => toLeg(r, "pe"));

  const byOiC = [...callLegs].sort((a, b) => b.oi - a.oi).slice(0, TOP);
  const byOiP = [...putLegs].sort((a, b) => b.oi - a.oi).slice(0, TOP);
  const byDeltC = [...callLegs].sort((a, b) => b.changeInOi - a.changeInOi).slice(0, TOP);
  const byDeltP = [...putLegs].sort((a, b) => b.changeInOi - a.changeInOi).slice(0, TOP);

  let netCall = 0;
  let netPut = 0;
  for (const r of strikes) {
    netCall += r.ce.changeInOi;
    netPut += r.pe.changeInOi;
  }
  netCall = r2(netCall);
  netPut = r2(netPut);

  const callFlow = flowBias(netCall);
  const putFlow = flowBias(netPut);

  const nC = fmtOiChg(netCall);
  const nP = fmtOiChg(netPut);
  let narrative: string;
  if (netCall > CUTOFF && netPut < -CUTOFF) {
    narrative = `CE ΔOI ${nC} vs PE ${nP} — call build with put unwind (directional / call writing often seen).`;
  } else if (netPut > CUTOFF && netCall < -CUTOFF) {
    narrative = `PE ΔOI ${nP} vs CE ${nC} — put build with call unwind (support / put writing or hedges).`;
  } else if (netCall > CUTOFF && netPut > CUTOFF) {
    narrative = `Both sides adding OI (CE ${nC}, PE ${nP}) — range or event risk; mind straddles & IV.`;
  } else {
    narrative = `Net CE Δ ${nC} · PE Δ ${nP} — mixed; use strike ladders for local walls.`;
  }

  return {
    topCallByOi: byOiC,
    topPutByOi: byOiP,
    topCallByOiChange: byDeltC,
    topPutByOiChange: byDeltP,
    netCallOiChange: netCall,
    netPutOiChange: netPut,
    callFlow,
    putFlow,
    narrative,
  };
}
