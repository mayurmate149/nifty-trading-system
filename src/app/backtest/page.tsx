"use client";

/**
 * Backtest Page
 *
 * Phase 7: Strategy backtesting with parameter form + results.
 */

import { useState } from "react";

export default function BacktestPage() {
  const [strategy, setStrategy] = useState("IRON_CONDOR");
  const [symbol, setSymbol] = useState("NIFTY");
  const [dateFrom, setDateFrom] = useState("2025-01-01");
  const [dateTo, setDateTo] = useState("2025-04-13");
  const [width, setWidth] = useState(100);
  const [slPct, setSlPct] = useState(1.0);
  const [tpPct, setTpPct] = useState(1.5);
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const runBacktest = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/backtest/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strategy,
          symbol,
          dateRange: { from: dateFrom, to: dateTo },
          params: { width, stopLossPct: slPct, targetPct: tpPct },
        }),
      });
      setResults(await res.json());
    } catch (err) {
      console.error("Backtest failed:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl p-6">
      <h1 className="mb-6 text-2xl font-bold">🔬 Backtesting</h1>

      {/* Parameter Form */}
      <div className="mb-8 grid grid-cols-2 gap-6 rounded-lg border border-gray-800 bg-gray-900 p-6 md:grid-cols-4">
        <div>
          <label className="mb-1 block text-xs text-gray-400">Strategy</label>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
            className="w-full rounded bg-gray-800 px-3 py-2 text-sm"
          >
            <option value="IRON_CONDOR">Iron Condor</option>
            <option value="CREDIT_SPREAD">Credit Spread</option>
            <option value="SHORT_STRADDLE">Short Straddle</option>
            <option value="SHORT_STRANGLE">Short Strangle</option>
            <option value="SCALP_SELL">Scalp Sell</option>
            <option value="DEBIT_SPREAD">Debit Spread</option>
            <option value="DIRECTIONAL_BUY">Directional Buy</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-400">Symbol</label>
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="w-full rounded bg-gray-800 px-3 py-2 text-sm"
          >
            <option value="NIFTY">NIFTY</option>
            <option value="BANKNIFTY">BANKNIFTY</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-400">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-full rounded bg-gray-800 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-400">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-full rounded bg-gray-800 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-400">Width (pts)</label>
          <input
            type="number"
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
            className="w-full rounded bg-gray-800 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-400">Stop Loss %</label>
          <input
            type="number"
            step="0.1"
            value={slPct}
            onChange={(e) => setSlPct(Number(e.target.value))}
            className="w-full rounded bg-gray-800 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-gray-400">Target %</label>
          <input
            type="number"
            step="0.1"
            value={tpPct}
            onChange={(e) => setTpPct(Number(e.target.value))}
            className="w-full rounded bg-gray-800 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex items-end">
          <button
            onClick={runBacktest}
            disabled={loading}
            className="w-full rounded bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {loading ? "Running..." : "▶ Run Backtest"}
          </button>
        </div>
      </div>

      {/* Results */}
      {results && (
        <div>
          {/* Summary Cards */}
          <div className="mb-6 grid grid-cols-4 gap-4">
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
              <div className="text-xs text-gray-400">Win Rate</div>
              <div className="text-xl font-bold text-green-400">{results.summary?.winRate}%</div>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
              <div className="text-xs text-gray-400">Avg Return/Trade</div>
              <div className="text-xl font-bold">{results.summary?.avgReturnPerTrade}%</div>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
              <div className="text-xs text-gray-400">Max Drawdown</div>
              <div className="text-xl font-bold text-red-400">{results.summary?.maxDrawdownPercent}%</div>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
              <div className="text-xs text-gray-400">Total Trades</div>
              <div className="text-xl font-bold">{results.trades?.length ?? 0}</div>
            </div>
          </div>

          {/* Equity Curve Placeholder */}
          <div className="mb-6 rounded-lg border border-gray-800 bg-gray-900 p-6">
            <p className="text-gray-400">📈 Equity curve chart will render here (Recharts/Plotly) — Phase 7</p>
          </div>

          {/* Trades Table */}
          <div className="overflow-x-auto rounded-lg border border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-900 text-gray-400">
                <tr>
                  <th className="px-4 py-3 text-left">Entry</th>
                  <th className="px-4 py-3 text-left">Exit</th>
                  <th className="px-4 py-3 text-right">P&L %</th>
                </tr>
              </thead>
              <tbody>
                {results.trades?.map((t: any, i: number) => (
                  <tr key={i} className="border-t border-gray-800">
                    <td className="px-4 py-2">{t.entryTime}</td>
                    <td className="px-4 py-2">{t.exitTime}</td>
                    <td className={`px-4 py-2 text-right font-medium ${
                      t.pnlPercent >= 0 ? "text-green-400" : "text-red-400"
                    }`}>
                      {t.pnlPercent}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
