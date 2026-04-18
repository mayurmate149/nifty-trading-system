"use client";

/**
 * OptionsChainTable Component
 *
 * Professional options chain display:
 * - Calls on the left, Strikes in center, Puts on the right
 * - Max OI strikes highlighted
 * - ΔOI color-coded (green = buildup, red = unwinding)
 * - IV, Greeks, Volume columns
 * - ATM row highlighted
 */

import { OptionChainStrike } from "@/types/market";

interface OptionsChainTableProps {
  chain: OptionChainStrike[];
  spot: number;
  atmStrike: number;
  maxCallOIStrike: number;
  maxPutOIStrike: number;
  className?: string;
}

export function OptionsChainTable({
  chain,
  spot,
  atmStrike,
  maxCallOIStrike,
  maxPutOIStrike,
  className = "",
}: OptionsChainTableProps) {
  if (!chain || chain.length === 0) {
    return (
      <div className={`flex h-64 items-center justify-center rounded-lg border border-gray-800 bg-gray-900 ${className}`}>
        <span className="text-sm text-gray-500">No options chain data</span>
      </div>
    );
  }

  return (
    <div className={`overflow-x-auto rounded-lg border border-gray-800 ${className}`}>
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10 bg-gray-900">
          {/* Group headers */}
          <tr className="border-b border-gray-700">
            <th colSpan={7} className="border-r border-gray-700 bg-green-900/10 px-2 py-2 text-center text-green-400">
              CALLS
            </th>
            <th className="bg-gray-800 px-2 py-2 text-center text-yellow-400">STRIKE</th>
            <th colSpan={7} className="border-l border-gray-700 bg-red-900/10 px-2 py-2 text-center text-red-400">
              PUTS
            </th>
          </tr>
          {/* Column headers */}
          <tr className="border-b border-gray-800 text-gray-500">
            <th className="px-2 py-1.5 text-right">OI</th>
            <th className="px-2 py-1.5 text-right">ΔOI</th>
            <th className="px-2 py-1.5 text-right">Vol</th>
            <th className="px-2 py-1.5 text-right">IV%</th>
            <th className="px-2 py-1.5 text-right">LTP</th>
            <th className="px-2 py-1.5 text-right">Δ</th>
            <th className="border-r border-gray-700 px-2 py-1.5 text-right">Θ</th>
            <th className="bg-gray-800/50 px-3 py-1.5 text-center font-bold">Strike</th>
            <th className="border-l border-gray-700 px-2 py-1.5 text-right">Θ</th>
            <th className="px-2 py-1.5 text-right">Δ</th>
            <th className="px-2 py-1.5 text-right">LTP</th>
            <th className="px-2 py-1.5 text-right">IV%</th>
            <th className="px-2 py-1.5 text-right">Vol</th>
            <th className="px-2 py-1.5 text-right">ΔOI</th>
            <th className="px-2 py-1.5 text-right">OI</th>
          </tr>
        </thead>
        <tbody>
          {chain.map((row) => {
            const isATM = row.strike === atmStrike;
            const isITMCall = row.strike < spot;
            const isITMPut = row.strike > spot;
            const isMaxCallOI = row.strike === maxCallOIStrike;
            const isMaxPutOI = row.strike === maxPutOIStrike;

            const rowBg = isATM
              ? "bg-yellow-900/20 border-y border-yellow-800/50"
              : "";

            return (
              <tr
                key={row.strike}
                className={`border-b border-gray-800/30 transition hover:bg-gray-800/40 ${rowBg}`}
              >
                {/* CALL side */}
                <td className={`px-2 py-1.5 text-right ${isITMCall ? "bg-green-900/5" : ""} ${isMaxCallOI ? "font-bold text-green-300" : "text-gray-300"}`}>
                  {formatOI(row.ce.oi)}
                </td>
                <td className={`px-2 py-1.5 text-right ${isITMCall ? "bg-green-900/5" : ""} ${row.ce.changeInOi > 0 ? "text-green-400" : row.ce.changeInOi < 0 ? "text-red-400" : "text-gray-500"}`}>
                  {formatOI(row.ce.changeInOi)}
                </td>
                <td className={`px-2 py-1.5 text-right text-gray-400 ${isITMCall ? "bg-green-900/5" : ""}`}>
                  {formatOI(row.ce.volume)}
                </td>
                <td className={`px-2 py-1.5 text-right text-gray-300 ${isITMCall ? "bg-green-900/5" : ""}`}>
                  {row.ce.iv.toFixed(1)}
                </td>
                <td className={`px-2 py-1.5 text-right font-medium ${isITMCall ? "bg-green-900/5 text-green-400" : "text-gray-200"}`}>
                  {row.ce.ltp.toFixed(2)}
                </td>
                <td className={`px-2 py-1.5 text-right text-blue-400 ${isITMCall ? "bg-green-900/5" : ""}`}>
                  {row.ce.greeks.delta.toFixed(2)}
                </td>
                <td className={`border-r border-gray-700 px-2 py-1.5 text-right text-gray-500 ${isITMCall ? "bg-green-900/5" : ""}`}>
                  {row.ce.greeks.theta.toFixed(1)}
                </td>

                {/* STRIKE */}
                <td className={`bg-gray-800/30 px-3 py-1.5 text-center font-bold ${isATM ? "text-yellow-400" : "text-gray-300"}`}>
                  {row.strike}
                  {isATM && <span className="ml-1 text-[9px] text-yellow-500">ATM</span>}
                </td>

                {/* PUT side */}
                <td className={`border-l border-gray-700 px-2 py-1.5 text-right text-gray-500 ${isITMPut ? "bg-red-900/5" : ""}`}>
                  {row.pe.greeks.theta.toFixed(1)}
                </td>
                <td className={`px-2 py-1.5 text-right text-blue-400 ${isITMPut ? "bg-red-900/5" : ""}`}>
                  {row.pe.greeks.delta.toFixed(2)}
                </td>
                <td className={`px-2 py-1.5 text-right font-medium ${isITMPut ? "bg-red-900/5 text-red-400" : "text-gray-200"}`}>
                  {row.pe.ltp.toFixed(2)}
                </td>
                <td className={`px-2 py-1.5 text-right text-gray-300 ${isITMPut ? "bg-red-900/5" : ""}`}>
                  {row.pe.iv.toFixed(1)}
                </td>
                <td className={`px-2 py-1.5 text-right text-gray-400 ${isITMPut ? "bg-red-900/5" : ""}`}>
                  {formatOI(row.pe.volume)}
                </td>
                <td className={`px-2 py-1.5 text-right ${isITMPut ? "bg-red-900/5" : ""} ${row.pe.changeInOi > 0 ? "text-green-400" : row.pe.changeInOi < 0 ? "text-red-400" : "text-gray-500"}`}>
                  {formatOI(row.pe.changeInOi)}
                </td>
                <td className={`px-2 py-1.5 text-right ${isITMPut ? "bg-red-900/5" : ""} ${isMaxPutOI ? "font-bold text-red-300" : "text-gray-300"}`}>
                  {formatOI(row.pe.oi)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatOI(val: number): string {
  if (val === 0) return "—";
  const abs = Math.abs(val);
  const sign = val < 0 ? "-" : "";
  if (abs >= 10000000) return `${sign}${(abs / 10000000).toFixed(1)}Cr`;
  if (abs >= 100000) return `${sign}${(abs / 100000).toFixed(1)}L`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}K`;
  return `${sign}${abs}`;
}
