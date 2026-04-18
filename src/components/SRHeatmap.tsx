"use client";

/**
 * SRHeatmap Component
 *
 * Displays Support & Resistance levels as a visual heatmap/range chart.
 * Shows current spot position relative to S/R zones.
 */

interface SRHeatmapProps {
  support: number[];
  resistance: number[];
  pivot: number;
  spot: number;
  className?: string;
}

export function SRHeatmap({
  support,
  resistance,
  pivot,
  spot,
  className = "",
}: SRHeatmapProps) {
  // Collect all levels
  const allLevels = [
    ...support.map((s) => ({ value: s, type: "support" as const, label: `S${support.indexOf(s) + 1}` })),
    ...resistance.map((r) => ({ value: r, type: "resistance" as const, label: `R${resistance.indexOf(r) + 1}` })),
    { value: pivot, type: "pivot" as const, label: "Pivot" },
    { value: spot, type: "spot" as const, label: "Spot" },
  ].sort((a, b) => a.value - b.value);

  if (allLevels.length < 2) {
    return (
      <div className={`flex h-40 items-center justify-center rounded-lg border border-gray-800 bg-gray-900 ${className}`}>
        <span className="text-sm text-gray-500">No S/R data available</span>
      </div>
    );
  }

  const min = allLevels[0].value * 0.998;
  const max = allLevels[allLevels.length - 1].value * 1.002;
  const range = max - min;

  const getPosition = (val: number) => ((val - min) / range) * 100;

  const typeColors = {
    support: { bg: "bg-green-500", text: "text-green-400", border: "border-green-500" },
    resistance: { bg: "bg-red-500", text: "text-red-400", border: "border-red-500" },
    pivot: { bg: "bg-yellow-500", text: "text-yellow-400", border: "border-yellow-500" },
    spot: { bg: "bg-blue-500", text: "text-blue-400", border: "border-blue-500" },
  };

  return (
    <div className={`rounded-lg border border-gray-800 bg-gray-900 p-4 ${className}`}>
      <h3 className="mb-4 text-sm font-medium text-gray-400">Support / Resistance Levels</h3>

      {/* Visual bar */}
      <div className="relative mb-6 h-12 rounded-full bg-gray-800">
        {/* Green zone (below pivot) */}
        <div
          className="absolute inset-y-0 left-0 rounded-l-full bg-green-900/20"
          style={{ width: `${getPosition(pivot)}%` }}
        />
        {/* Red zone (above pivot) */}
        <div
          className="absolute inset-y-0 right-0 rounded-r-full bg-red-900/20"
          style={{ width: `${100 - getPosition(pivot)}%` }}
        />

        {/* Level markers */}
        {allLevels.map((level, i) => {
          const pos = getPosition(level.value);
          const colors = typeColors[level.type];
          const isSpot = level.type === "spot";

          return (
            <div
              key={`${level.type}-${i}`}
              className="absolute top-0 h-full"
              style={{ left: `${pos}%` }}
            >
              {/* Vertical line */}
              <div className={`absolute inset-y-0 w-0.5 ${colors.bg} ${isSpot ? "opacity-100" : "opacity-60"}`} />

              {/* Label (alternate above/below) */}
              <div
                className={`absolute whitespace-nowrap text-[10px] font-medium ${colors.text} ${
                  i % 2 === 0 ? "-top-5" : "-bottom-5"
                }`}
                style={{ transform: "translateX(-50%)" }}
              >
                {level.label}: {level.value.toFixed(0)}
              </div>

              {/* Spot marker is bigger */}
              {isSpot && (
                <div className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-blue-400 bg-blue-500/50" />
              )}
            </div>
          );
        })}
      </div>

      {/* Level details grid */}
      <div className="mt-8 grid grid-cols-3 gap-3">
        <div>
          <div className="mb-2 text-[11px] font-medium uppercase text-green-400">Support</div>
          {support.map((s, i) => (
            <div key={i} className="flex items-center gap-2 py-1">
              <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
              <span className="text-sm text-gray-300">S{i + 1}: {s.toFixed(2)}</span>
              <span className="text-xs text-gray-500">
                ({((spot - s) / spot * 100).toFixed(2)}% below)
              </span>
            </div>
          ))}
        </div>
        <div className="text-center">
          <div className="mb-2 text-[11px] font-medium uppercase text-yellow-400">Pivot</div>
          <div className="text-lg font-bold text-yellow-400">{pivot.toFixed(2)}</div>
          <div className="text-xs text-gray-500">
            Spot is {spot > pivot ? "above" : "below"} pivot ({Math.abs(((spot - pivot) / pivot) * 100).toFixed(2)}%)
          </div>
        </div>
        <div>
          <div className="mb-2 text-[11px] font-medium uppercase text-red-400">Resistance</div>
          {resistance.map((r, i) => (
            <div key={i} className="flex items-center gap-2 py-1">
              <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
              <span className="text-sm text-gray-300">R{i + 1}: {r.toFixed(2)}</span>
              <span className="text-xs text-gray-500">
                ({((r - spot) / spot * 100).toFixed(2)}% above)
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
