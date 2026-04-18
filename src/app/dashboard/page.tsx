"use client";

/**
 * Dashboard Page — Phase 4
 *
 * Main landing page after login. Shows:
 * - Market header (spot, VIX, trend)
 * - Portfolio summary cards
 * - Intraday P&L chart
 * - Greeks exposure
 * - Payoff diagram
 * - Quick links to other pages
 */

import { useQuery } from "@tanstack/react-query";
import { MarketHeader } from "@/components/MarketHeader";
import { PnLChart } from "@/components/PnLChart";
import { PayoffDiagram } from "@/components/PayoffDiagram";
import { GreeksPanel } from "@/components/GreeksPanel";
import Link from "next/link";

async function fetchAnalytics() {
  const res = await fetch("/api/v1/analytics/summary");
  if (!res.ok) throw new Error("Failed to fetch analytics");
  return res.json();
}

async function fetchIndicators() {
  const res = await fetch("/api/v1/market/indicators");
  if (!res.ok) throw new Error("Failed to fetch indicators");
  return res.json();
}

export default function DashboardPage() {
  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ["analytics-summary"],
    queryFn: fetchAnalytics,
    refetchInterval: 5000,
  });

  const { data: indicators } = useQuery({
    queryKey: ["indicators"],
    queryFn: fetchIndicators,
    refetchInterval: 5000,
  });

  const portfolio = analytics?.portfolio;
  const greeks = analytics?.greeks;
  const payoff = analytics?.payoff;
  const pnlHistory = analytics?.pnlHistory;
  const market = analytics?.market;

  return (
    <div className="mx-auto max-w-7xl p-6">
      {/* Page Title */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">🏠 Dashboard</h1>
          <p className="text-sm text-gray-500">Portfolio overview & market analysis</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/positions"
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 transition hover:bg-gray-700"
          >
            📊 Positions
          </Link>
          <Link
            href="/analytics"
            className="rounded-lg bg-blue-900/50 px-4 py-2 text-sm font-medium text-blue-400 transition hover:bg-blue-900/70"
          >
            📈 Analytics
          </Link>
        </div>
      </div>

      {/* Market Header */}
      <MarketHeader indicators={indicators} bankNifty={market?.bankNifty} />

      {/* Portfolio Summary Cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <SummaryCard
          label="Total P&L"
          value={portfolio ? `₹${portfolio.totalPnl.toLocaleString("en-IN")}` : "—"}
          sub={portfolio ? `${portfolio.totalPnlPct >= 0 ? "+" : ""}${portfolio.totalPnlPct.toFixed(2)}%` : ""}
          valueColor={portfolio?.totalPnl >= 0 ? "text-green-400" : "text-red-400"}
          subColor={portfolio?.totalPnlPct >= 0 ? "text-green-500" : "text-red-500"}
        />
        <SummaryCard
          label="Capital Deployed"
          value={portfolio ? `₹${portfolio.totalCapitalDeployed.toLocaleString("en-IN")}` : "—"}
          sub={`${portfolio?.openPositions ?? 0} open positions`}
        />
        <SummaryCard
          label="Margin Used"
          value={portfolio ? `₹${portfolio.marginUsed.toLocaleString("en-IN")}` : "—"}
          sub={portfolio ? `${portfolio.marginUtilization.toFixed(1)}% utilized` : ""}
          subColor={portfolio?.marginUtilization > 80 ? "text-red-400" : "text-gray-500"}
        />
        <SummaryCard
          label="Day High"
          value={portfolio ? `₹${portfolio.dayHigh.toFixed(0)}` : "—"}
          valueColor="text-green-400"
        />
        <SummaryCard
          label="Day Low"
          value={portfolio ? `₹${portfolio.dayLow.toFixed(0)}` : "—"}
          valueColor="text-red-400"
        />
      </div>

      {/* Charts Row */}
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <PnLChart data={pnlHistory ?? []} />
        <PayoffDiagram data={payoff ?? []} spot={market?.spot ?? 22500} />
      </div>

      {/* Greeks Panel */}
      <div className="mb-6">
        <GreeksPanel greeks={greeks} />
      </div>

      {/* Quick Stats Footer */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <QuickStat icon="🌡️" label="India VIX" value={market?.vix?.toFixed(2) ?? "—"} />
        <QuickStat icon="📅" label="Days to Expiry" value={market?.daysToExpiry?.toFixed(1) ?? "—"} />
        <QuickStat icon="📊" label="Base IV" value={`${market?.iv ?? 0}%`} />
        <QuickStat
          icon="🔮"
          label="Market Trend"
          value={market?.trend ?? "—"}
          valueColor={
            market?.trend === "BULLISH"
              ? "text-green-400"
              : market?.trend === "BEARISH"
              ? "text-red-400"
              : "text-yellow-400"
          }
        />
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────

function SummaryCard({
  label,
  value,
  sub,
  valueColor = "text-gray-100",
  subColor = "text-gray-500",
}: {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
  subColor?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 transition hover:border-gray-700">
      <div className="mb-1 text-xs font-medium text-gray-500">{label}</div>
      <div className={`text-xl font-bold ${valueColor}`}>{value}</div>
      {sub && <div className={`mt-1 text-xs ${subColor}`}>{sub}</div>}
    </div>
  );
}

function QuickStat({
  icon,
  label,
  value,
  valueColor = "text-gray-200",
}: {
  icon: string;
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-900/50 p-3">
      <span className="text-xl">{icon}</span>
      <div>
        <div className="text-[11px] text-gray-500">{label}</div>
        <div className={`text-sm font-semibold ${valueColor}`}>{value}</div>
      </div>
    </div>
  );
}
