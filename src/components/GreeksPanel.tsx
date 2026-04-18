"use client";

/**
 * GreeksPanel Component
 *
 * Shows portfolio-level Greeks exposure with per-position breakdown.
 */

import { GreeksExposure } from "@/types/market";

interface GreeksPanelProps {
  greeks: GreeksExposure | null;
  className?: string;
}

export function GreeksPanel({ greeks, className = "" }: GreeksPanelProps) {
  if (!greeks) {
    return (
      <div className={`rounded-lg border border-gray-800 bg-gray-900 p-4 ${className}`}>
        <span className="text-sm text-gray-500">Loading Greeks...</span>
      </div>
    );
  }

  const greekCards = [
    {
      label: "Delta (Δ)",
      value: greeks.totalDelta,
      description: "Directional exposure",
      color: greeks.totalDelta >= 0 ? "text-green-400" : "text-red-400",
      bgColor: greeks.totalDelta >= 0 ? "bg-green-900/20" : "bg-red-900/20",
    },
    {
      label: "Gamma (Γ)",
      value: greeks.totalGamma,
      description: "Delta sensitivity",
      color: "text-blue-400",
      bgColor: "bg-blue-900/20",
    },
    {
      label: "Theta (Θ)",
      value: greeks.totalTheta,
      description: "Time decay / day",
      color: greeks.totalTheta >= 0 ? "text-green-400" : "text-red-400",
      bgColor: greeks.totalTheta >= 0 ? "bg-green-900/20" : "bg-red-900/20",
    },
    {
      label: "Vega (ν)",
      value: greeks.totalVega,
      description: "IV sensitivity",
      color: "text-purple-400",
      bgColor: "bg-purple-900/20",
    },
  ];

  return (
    <div className={`rounded-lg border border-gray-800 bg-gray-900 p-4 ${className}`}>
      <h3 className="mb-4 text-sm font-medium text-gray-400">Greeks Exposure</h3>

      {/* Summary cards */}
      <div className="mb-4 grid grid-cols-4 gap-3">
        {greekCards.map((g) => (
          <div key={g.label} className={`rounded-lg p-3 ${g.bgColor}`}>
            <div className="text-[11px] font-medium text-gray-500">{g.label}</div>
            <div className={`text-lg font-bold ${g.color}`}>{g.value.toFixed(2)}</div>
            <div className="text-[10px] text-gray-600">{g.description}</div>
          </div>
        ))}
      </div>

      {/* Per-position breakdown */}
      {greeks.perPosition.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800 text-gray-500">
                <th className="px-2 py-2 text-left">Position</th>
                <th className="px-2 py-2 text-right">Qty</th>
                <th className="px-2 py-2 text-right">Delta</th>
                <th className="px-2 py-2 text-right">Gamma</th>
                <th className="px-2 py-2 text-right">Theta</th>
                <th className="px-2 py-2 text-right">Vega</th>
              </tr>
            </thead>
            <tbody>
              {greeks.perPosition.map((pos) => (
                <tr key={pos.positionId} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="px-2 py-1.5 font-medium text-gray-300">{pos.symbol}</td>
                  <td className={`px-2 py-1.5 text-right ${pos.quantity > 0 ? "text-green-400" : "text-red-400"}`}>
                    {pos.quantity}
                  </td>
                  <td className={`px-2 py-1.5 text-right ${pos.delta >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {pos.delta.toFixed(2)}
                  </td>
                  <td className="px-2 py-1.5 text-right text-blue-400">{pos.gamma.toFixed(4)}</td>
                  <td className={`px-2 py-1.5 text-right ${pos.theta >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {pos.theta.toFixed(2)}
                  </td>
                  <td className="px-2 py-1.5 text-right text-purple-400">{pos.vega.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
