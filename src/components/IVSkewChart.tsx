"use client";

/**
 * IVSkewChart Component
 *
 * Recharts line chart showing IV smile/skew across strikes for both CE and PE.
 */

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { IVSkewPoint } from "@/types/market";

interface IVSkewChartProps {
  data: IVSkewPoint[];
  atmStrike: number;
  className?: string;
}

export function IVSkewChart({ data, atmStrike, className = "" }: IVSkewChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className={`flex h-64 items-center justify-center rounded-lg border border-gray-800 bg-gray-900 ${className}`}>
        <span className="text-sm text-gray-500">No IV data available</span>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border border-gray-800 bg-gray-900 p-4 ${className}`}>
      <h3 className="mb-3 text-sm font-medium text-gray-400">IV Skew / Smile</h3>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="strike"
            tickFormatter={(v) => v.toFixed(0)}
            tick={{ fill: "#6b7280", fontSize: 11 }}
            axisLine={{ stroke: "#374151" }}
          />
          <YAxis
            tickFormatter={(v) => `${v.toFixed(1)}%`}
            tick={{ fill: "#6b7280", fontSize: 11 }}
            axisLine={{ stroke: "#374151" }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#111827",
              border: "1px solid #374151",
              borderRadius: "8px",
              fontSize: "12px",
            }}
            formatter={(value: number, name: string) => [
              `${value.toFixed(2)}%`,
              name === "callIV" ? "Call IV" : "Put IV",
            ]}
            labelFormatter={(label) => `Strike: ${label}`}
          />
          <Legend
            wrapperStyle={{ fontSize: "12px", color: "#9ca3af" }}
            formatter={(value) => (value === "callIV" ? "Call IV" : "Put IV")}
          />
          <ReferenceLine
            x={atmStrike}
            stroke="#eab308"
            strokeDasharray="5 5"
            label={{ value: "ATM", fill: "#eab308", fontSize: 11 }}
          />
          <Line
            type="monotone"
            dataKey="callIV"
            stroke="#22c55e"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: "#22c55e" }}
          />
          <Line
            type="monotone"
            dataKey="putIV"
            stroke="#ef4444"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: "#ef4444" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
