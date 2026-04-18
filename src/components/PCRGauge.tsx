"use client";

/**
 * PCR Gauge Component
 *
 * Visual gauge for Put-Call Ratio with interpretation:
 * < 0.7  → Bullish (extreme call buying)
 * 0.7–1.0 → Mildly Bullish
 * 1.0–1.2 → Neutral
 * 1.2–1.5 → Mildly Bearish
 * > 1.5  → Bearish (extreme put buying)
 */

interface PCRGaugeProps {
  pcr: number;
  totalCallOI: number;
  totalPutOI: number;
  className?: string;
}

export function PCRGauge({ pcr, totalCallOI, totalPutOI, className = "" }: PCRGaugeProps) {
  const clampedPcr = Math.max(0, Math.min(2.5, pcr));
  const percentage = (clampedPcr / 2.5) * 100;

  let interpretation: string;
  let color: string;

  if (pcr < 0.7) {
    interpretation = "Extremely Bullish";
    color = "text-green-400";
  } else if (pcr < 1.0) {
    interpretation = "Mildly Bullish";
    color = "text-green-300";
  } else if (pcr <= 1.2) {
    interpretation = "Neutral";
    color = "text-yellow-400";
  } else if (pcr <= 1.5) {
    interpretation = "Mildly Bearish";
    color = "text-orange-400";
  } else {
    interpretation = "Extremely Bearish";
    color = "text-red-400";
  }

  return (
    <div className={`rounded-lg border border-gray-800 bg-gray-900 p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-400">Put-Call Ratio</span>
        <span className={`text-lg font-bold ${color}`}>{pcr.toFixed(2)}</span>
      </div>

      {/* Gauge bar */}
      <div className="relative mb-3 h-3 overflow-hidden rounded-full bg-gray-800">
        {/* Gradient background */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: "linear-gradient(to right, #22c55e, #eab308, #ef4444)",
          }}
        />
        {/* Pointer */}
        <div
          className="absolute top-0 h-full w-1 bg-white shadow-lg transition-all duration-500"
          style={{ left: `${percentage}%` }}
        />
      </div>

      {/* Scale labels */}
      <div className="mb-3 flex justify-between text-[10px] text-gray-500">
        <span>0</span>
        <span>0.7</span>
        <span>1.0</span>
        <span>1.5</span>
        <span>2.5</span>
      </div>

      {/* Interpretation */}
      <div className={`mb-3 text-center text-sm font-medium ${color}`}>
        {interpretation}
      </div>

      {/* OI breakdown */}
      <div className="flex justify-between text-xs text-gray-400">
        <span>
          Call OI: <span className="text-green-400">{formatOI(totalCallOI)}</span>
        </span>
        <span>
          Put OI: <span className="text-red-400">{formatOI(totalPutOI)}</span>
        </span>
      </div>
    </div>
  );
}

function formatOI(oi: number): string {
  if (oi >= 10000000) return `${(oi / 10000000).toFixed(2)}Cr`;
  if (oi >= 100000) return `${(oi / 100000).toFixed(2)}L`;
  if (oi >= 1000) return `${(oi / 1000).toFixed(1)}K`;
  return oi.toString();
}
