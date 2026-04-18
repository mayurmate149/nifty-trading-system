"use client";

/**
 * PnLChart Component
 *
 * Recharts area chart showing intraday P&L and spot price over time.
 */

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Line,
  ComposedChart,
} from "recharts";
import { PnLDataPoint } from "@/types/market";

interface PnLChartProps {
  data: PnLDataPoint[];
  className?: string;
}

export function PnLChart({ data, className = "" }: PnLChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className={`flex h-64 items-center justify-center rounded-lg border border-gray-800 bg-gray-900 ${className}`}>
        <span className="text-sm text-gray-500">Collecting P&L data... (updates every 5s)</span>
      </div>
    );
  }

  const currentPnl = data[data.length - 1]?.pnl ?? 0;
  const maxPnl = Math.max(...data.map((d) => d.pnl));
  const minPnl = Math.min(...data.map((d) => d.pnl));
  const pnlColor = currentPnl >= 0 ? "#22c55e" : "#ef4444";

  // Format time labels (show HH:MM)
  const formattedData = data.map((d) => ({
    ...d,
    timeLabel: new Date(d.time).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  }));

  return (
    <div className={`rounded-lg border border-gray-800 bg-gray-900 p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-400">Intraday P&L</h3>
        <div className="flex gap-4 text-xs">
          <span className="text-gray-500">
            High: <span className="text-green-400">₹{maxPnl.toFixed(0)}</span>
          </span>
          <span className="text-gray-500">
            Low: <span className="text-red-400">₹{minPnl.toFixed(0)}</span>
          </span>
          <span className={currentPnl >= 0 ? "text-green-400" : "text-red-400"}>
            Now: ₹{currentPnl.toFixed(0)}
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={formattedData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <defs>
            <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={pnlColor} stopOpacity={0.3} />
              <stop offset="100%" stopColor={pnlColor} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="timeLabel"
            tick={{ fill: "#6b7280", fontSize: 10 }}
            axisLine={{ stroke: "#374151" }}
            interval="preserveStartEnd"
          />
          <YAxis
            yAxisId="pnl"
            tickFormatter={(v) => `₹${v}`}
            tick={{ fill: "#6b7280", fontSize: 10 }}
            axisLine={{ stroke: "#374151" }}
          />
          <YAxis
            yAxisId="spot"
            orientation="right"
            tick={{ fill: "#4b5563", fontSize: 10 }}
            axisLine={{ stroke: "#374151" }}
            tickFormatter={(v) => v.toFixed(0)}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#111827",
              border: "1px solid #374151",
              borderRadius: "8px",
              fontSize: "12px",
            }}
            formatter={(value: number, name: string) => {
              if (name === "pnl") return [`₹${value.toFixed(2)}`, "P&L"];
              return [value.toFixed(2), "Spot"];
            }}
          />
          <Area
            yAxisId="pnl"
            type="monotone"
            dataKey="pnl"
            stroke={pnlColor}
            fill="url(#pnlGrad)"
            strokeWidth={2}
          />
          <Line
            yAxisId="spot"
            type="monotone"
            dataKey="spot"
            stroke="#6366f1"
            strokeWidth={1}
            dot={false}
            strokeDasharray="3 3"
            opacity={0.5}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
