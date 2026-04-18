"use client";

/**
 * Analytics Page — Phase 4
 *
 * Full market analysis dashboard with tabs:
 * - Options Chain (calls left, strikes center, puts right)
 * - Indicators (VIX, PCR gauge, IV skew, trend)
 * - S/R Heatmap (support/resistance visualization)
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MarketHeader } from "@/components/MarketHeader";
import { OptionsChainTable } from "@/components/OptionsChainTable";
import { PCRGauge } from "@/components/PCRGauge";
import { IVSkewChart } from "@/components/IVSkewChart";
import { SRHeatmap } from "@/components/SRHeatmap";
import { PayoffDiagram } from "@/components/PayoffDiagram";
import { GreeksPanel } from "@/components/GreeksPanel";
import type { OptionsChainResponse, MarketIndicators } from "@/types/market";

type TabKey = "chain" | "indicators" | "heatmap" | "greeks";

async function fetchIndicators(): Promise<MarketIndicators> {
  const res = await fetch("/api/v1/market/indicators");
  if (!res.ok) throw new Error("Failed to fetch indicators");
  return res.json();
}

async function fetchOptionsChain(symbol: string): Promise<OptionsChainResponse> {
  const res = await fetch(`/api/v1/market/options-chain?symbol=${symbol}`);
  if (!res.ok) throw new Error("Failed to fetch options chain");
  return res.json();
}

async function fetchAnalytics() {
  const res = await fetch("/api/v1/analytics/summary?section=all");
  if (!res.ok) throw new Error("Failed to fetch analytics");
  return res.json();
}

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("chain");
  const [symbol, setSymbol] = useState("NIFTY");

  const { data: indicators } = useQuery({
    queryKey: ["indicators"],
    queryFn: fetchIndicators,
    refetchInterval: 5000,
  });

  const { data: chain, isLoading: chainLoading } = useQuery({
    queryKey: ["options-chain", symbol],
    queryFn: () => fetchOptionsChain(symbol),
    refetchInterval: 5000,
  });

  const { data: analytics } = useQuery({
    queryKey: ["analytics-full"],
    queryFn: fetchAnalytics,
    refetchInterval: 10000,
  });

  const tabs: { key: TabKey; label: string; icon: string }[] = [
    { key: "chain", label: "Options Chain", icon: "📋" },
    { key: "indicators", label: "Indicators", icon: "📈" },
    { key: "heatmap", label: "S/R Levels", icon: "🗺️" },
    { key: "greeks", label: "Greeks & Payoff", icon: "🔬" },
  ];

  return (
    <div className="mx-auto max-w-7xl p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">📊 Market Analysis</h1>
          <p className="text-sm text-gray-500">Live options chain, IV, Greeks & S/R levels</p>
        </div>
        <div className="flex gap-2">
          {["NIFTY", "BANKNIFTY"].map((s) => (
            <button
              key={s}
              onClick={() => setSymbol(s)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                symbol === s
                  ? "bg-blue-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Market Header Widgets */}
      <MarketHeader indicators={indicators} bankNifty={analytics?.market?.bankNifty} />

      {/* Chain Summary Bar */}
      {chain && chain.spot > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-4 rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-3 text-xs">
          <span className="text-gray-400">
            ATM: <span className="font-bold text-yellow-400">{chain.atmStrike}</span>
          </span>
          <span className="text-gray-400">
            PCR: <span className={`font-bold ${chain.pcr > 1 ? "text-red-400" : "text-green-400"}`}>
              {chain.pcr.toFixed(2)}
            </span>
          </span>
          <span className="text-gray-400">
            Max Call OI: <span className="font-bold text-green-400">{chain.maxCallOIStrike}</span>
          </span>
          <span className="text-gray-400">
            Max Put OI: <span className="font-bold text-red-400">{chain.maxPutOIStrike}</span>
          </span>
          <span className="text-gray-400">
            Total Call OI: <span className="text-gray-300">{formatLargeNumber(chain.totalCallOI)}</span>
          </span>
          <span className="text-gray-400">
            Total Put OI: <span className="text-gray-300">{formatLargeNumber(chain.totalPutOI)}</span>
          </span>
          <span className="text-gray-400">
            Expiry: <span className="text-gray-300">{chain.expiry}</span>
          </span>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-4 flex gap-1 border-b border-gray-800">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition ${
              activeTab === tab.key
                ? "border-b-2 border-blue-500 text-blue-400"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {/* Options Chain Tab */}
        {activeTab === "chain" && (
          <div>
            {chainLoading ? (
              <div className="flex h-64 items-center justify-center rounded-lg border border-gray-800 bg-gray-900">
                <div className="text-center">
                  <div className="mb-2 text-2xl">⏳</div>
                  <p className="text-sm text-gray-400">Loading options chain...</p>
                </div>
              </div>
            ) : chain && chain.chain?.length > 0 ? (
              <div>
                <OptionsChainTable
                  chain={chain.chain}
                  spot={chain.spot}
                  atmStrike={chain.atmStrike}
                  maxCallOIStrike={chain.maxCallOIStrike}
                  maxPutOIStrike={chain.maxPutOIStrike}
                />
                <div className="mt-3 text-center text-xs text-gray-600">
                  {chain.chain.length} strikes · Auto-refreshing every 3s · {symbol} · Expiry: {chain.expiry}
                </div>
              </div>
            ) : (
              <div className="flex h-64 items-center justify-center rounded-lg border border-gray-800 bg-gray-900">
                <p className="text-sm text-gray-500">No chain data — make sure simulator is running</p>
              </div>
            )}
          </div>
        )}

        {/* Indicators Tab */}
        {activeTab === "indicators" && (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* PCR Gauge */}
            <PCRGauge
              pcr={chain?.pcr ?? 0}
              totalCallOI={chain?.totalCallOI ?? 0}
              totalPutOI={chain?.totalPutOI ?? 0}
            />

            {/* Detailed Indicators */}
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
              <h3 className="mb-4 text-sm font-medium text-gray-400">Market Indicators</h3>
              <div className="space-y-3">
                <IndicatorRow label="Spot Price" value={indicators?.spot?.toLocaleString("en-IN") ?? "—"} />
                <IndicatorRow
                  label="Spot Change"
                  value={`${indicators?.spotChange?.toFixed(2) ?? "0"} (${indicators?.spotChangePct?.toFixed(2) ?? "0"}%)`}
                  valueColor={
                    (indicators?.spotChangePct ?? 0) >= 0 ? "text-green-400" : "text-red-400"
                  }
                />
                <IndicatorRow label="India VIX" value={indicators?.vix?.toFixed(2) ?? "—"} />
                <IndicatorRow label="IV Percentile" value={`${indicators?.ivPercentile ?? 0}%`} />
                <IndicatorRow
                  label="Trend"
                  value={indicators?.trend ?? "—"}
                  valueColor={
                    indicators?.trend === "trend-up"
                      ? "text-green-400"
                      : indicators?.trend === "trend-down"
                      ? "text-red-400"
                      : "text-yellow-400"
                  }
                />
                <IndicatorRow label="Trend Strength" value={`${indicators?.trendStrength ?? 0}%`} />
                <IndicatorRow label="Pivot Point" value={indicators?.pivotPoint?.toFixed(2) ?? "—"} />
                <IndicatorRow label="Days to Expiry" value={indicators?.daysToExpiry?.toFixed(1) ?? "—"} />
              </div>
            </div>

            {/* IV Skew Chart (full width) */}
            <div className="lg:col-span-2">
              <IVSkewChart
                data={analytics?.ivSkew ?? []}
                atmStrike={chain?.atmStrike ?? 0}
              />
            </div>
          </div>
        )}

        {/* S/R Heatmap Tab */}
        {activeTab === "heatmap" && (
          <div>
            <SRHeatmap
              support={indicators?.support ?? []}
              resistance={indicators?.resistance ?? []}
              pivot={indicators?.pivotPoint ?? 0}
              spot={indicators?.spot ?? 0}
            />
          </div>
        )}

        {/* Greeks & Payoff Tab */}
        {activeTab === "greeks" && (
          <div className="space-y-6">
            <GreeksPanel greeks={analytics?.greeks ?? null} />
            <PayoffDiagram
              data={analytics?.payoff ?? []}
              spot={analytics?.market?.spot ?? 22500}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helper Components ───────────────────────

function IndicatorRow({
  label,
  value,
  valueColor = "text-gray-200",
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="flex items-center justify-between border-b border-gray-800/50 pb-2">
      <span className="text-sm text-gray-400">{label}</span>
      <span className={`text-sm font-medium ${valueColor}`}>{value}</span>
    </div>
  );
}

function formatLargeNumber(n: number): string {
  if (n >= 10000000) return `${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `${(n / 100000).toFixed(2)} L`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}
