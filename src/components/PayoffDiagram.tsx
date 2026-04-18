"use client";

/**
 * PayoffDiagram Component
 *
 * Recharts area chart showing portfolio payoff at expiry across spot prices.
 * Green area for profit, red area for loss. Vertical line at current spot.
 */

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { PayoffPoint } from "@/types/market";

interface PayoffDiagramProps {
  data: PayoffPoint[];
  spot: number;
  className?: string;
}

export function PayoffDiagram({ data, spot, className = "" }: PayoffDiagramProps) {
  if (!data || data.length === 0) {
    return (
      <div className={`flex h-64 items-center justify-center rounded-lg border border-gray-800 bg-gray-900 ${className}`}>
        <span className="text-sm text-gray-500">No position data for payoff diagram</span>
      </div>
    );
  }

  // Split into positive and negative for dual-color areas
  const enrichedData = data.map((d) => ({
    ...d,
    profit: d.payoff >= 0 ? d.payoff : 0,
    loss: d.payoff < 0 ? d.payoff : 0,
  }));

  const maxPayoff = Math.max(...data.map((d) => Math.abs(d.payoff)), 100);
  const breakevens = findBreakevens(data);

  return (
    <div className={`rounded-lg border border-gray-800 bg-gray-900 p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-400">Payoff at Expiry</h3>
        <div className="flex gap-3 text-xs text-gray-500">
          {breakevens.map((be, i) => (
            <span key={i}>
              BE: <span className="text-yellow-400">{be.toFixed(0)}</span>
            </span>
          ))}
          <span>
            Max Profit: <span className="text-green-400">₹{Math.max(...data.map((d) => d.payoff)).toFixed(0)}</span>
          </span>
          <span>
            Max Loss: <span className="text-red-400">₹{Math.min(...data.map((d) => d.payoff)).toFixed(0)}</span>
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={250}>
        <AreaChart data={enrichedData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
          <defs>
            <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22c55e" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#22c55e" stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="lossGrad" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#ef4444" stopOpacity={0.4} />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="spot"
            tickFormatter={(v) => v.toFixed(0)}
            tick={{ fill: "#6b7280", fontSize: 11 }}
            axisLine={{ stroke: "#374151" }}
          />
          <YAxis
            tickFormatter={(v) => `₹${v.toFixed(0)}`}
            tick={{ fill: "#6b7280", fontSize: 11 }}
            axisLine={{ stroke: "#374151" }}
            domain={[-maxPayoff * 1.1, maxPayoff * 1.1]}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#111827",
              border: "1px solid #374151",
              borderRadius: "8px",
              fontSize: "12px",
            }}
            formatter={(value: number) => [`₹${value.toFixed(2)}`, "Payoff"]}
            labelFormatter={(label) => `Spot: ${Number(label).toFixed(2)}`}
          />
          <ReferenceLine y={0} stroke="#4b5563" strokeDasharray="5 5" />
          <ReferenceLine
            x={spot}
            stroke="#eab308"
            strokeDasharray="5 5"
            label={{ value: "CMP", fill: "#eab308", fontSize: 11 }}
          />
          <Area
            type="monotone"
            dataKey="profit"
            stroke="#22c55e"
            fill="url(#profitGrad)"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="loss"
            stroke="#ef4444"
            fill="url(#lossGrad)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function findBreakevens(data: PayoffPoint[]): number[] {
  const breakevens: number[] = [];
  for (let i = 1; i < data.length; i++) {
    if (
      (data[i - 1].payoff <= 0 && data[i].payoff > 0) ||
      (data[i - 1].payoff >= 0 && data[i].payoff < 0)
    ) {
      // Linear interpolation
      const ratio = Math.abs(data[i - 1].payoff) / (Math.abs(data[i - 1].payoff) + Math.abs(data[i].payoff));
      breakevens.push(data[i - 1].spot + ratio * (data[i].spot - data[i - 1].spot));
    }
  }
  return breakevens;
}
