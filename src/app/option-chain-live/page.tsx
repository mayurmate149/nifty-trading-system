"use client";

/**
 * Options chain with live LTP from 5paisa Xstream `MarketFeedV3` (via xstream-ws-gateway).
 * REST loads chain structure + scrip codes; browser subscribes to those scrip tokens over WebSocket.
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useMarketTicks } from "@/contexts/MarketTicksContext";
import { OptionsChainTable } from "@/components/OptionsChainTable";
import type { OptionsChainResponse, OptionChainStrike } from "@/types/market";
import type { MarketFeedInstrument } from "@/types/option-ws";

type ChainWsResponse = {
  chain: OptionsChainResponse;
  wsInstruments: MarketFeedInstrument[];
  error?: string;
};

async function fetchChainWs(symbol: string): Promise<ChainWsResponse> {
  const res = await fetch(
    `/api/v1/market/option-chain-ws?symbol=${encodeURIComponent(symbol)}`,
  );
  if (!res.ok) throw new Error("Failed to load option chain");
  return res.json();
}

function mergeLtp(
  chain: OptionChainStrike[],
  tickByToken: Record<
    number,
    { lastRate?: number; pClose?: number; totalQty?: number }
  >,
): OptionChainStrike[] {
  return chain.map((row) => {
    const ceSc = (row.ce.scripCode ?? "").trim();
    const peSc = (row.pe.scripCode ?? "").trim();
    const ceTok = ceSc ? parseInt(ceSc, 10) : 0;
    const peTok = peSc ? parseInt(peSc, 10) : 0;
    const ceT = ceTok > 0 ? tickByToken[ceTok] : undefined;
    const peT = peTok > 0 ? tickByToken[peTok] : undefined;
    const ceLtp =
      ceT?.lastRate && ceT.lastRate > 0 ? ceT.lastRate : row.ce.ltp;
    const peLtp =
      peT?.lastRate && peT.lastRate > 0 ? peT.lastRate : row.pe.ltp;
    return {
      ...row,
      ce: { ...row.ce, ltp: ceLtp, volume: ceT?.totalQty ?? row.ce.volume },
      pe: { ...row.pe, ltp: peLtp, volume: peT?.totalQty ?? row.pe.volume },
    };
  });
}

export default function OptionChainLivePage() {
  const [symbol, setSymbol] = useState("NIFTY");
  const rt = useMarketTicks();
  const hasWs = Boolean(process.env.NEXT_PUBLIC_XSTREAM_WS_URL?.trim());

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["option-chain-ws", symbol],
    queryFn: () => fetchChainWs(symbol),
    staleTime: 60_000,
  });

  const tickByToken = rt?.tickByToken ?? {};
  const send = rt?.sendGatewayMessage;

  const displayChain = useMemo(() => {
    if (!data?.chain?.chain?.length) return [];
    return mergeLtp(data.chain.chain, tickByToken);
  }, [data?.chain?.chain, tickByToken]);

  const instKey = useMemo(
    () => JSON.stringify(data?.wsInstruments ?? []),
    [data?.wsInstruments],
  );

  useEffect(() => {
    if (!hasWs || !send || rt?.connection !== "open") return;
    const inst = data?.wsInstruments;
    if (!inst || inst.length === 0) return;
    send({ type: "market-feed-subscribe", instruments: inst });
    return () => {
      send({ type: "market-feed-subscribe", instruments: [] });
    };
  }, [hasWs, send, rt?.connection, instKey, data?.wsInstruments]);

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">📡 Live options chain (WebSocket)</h1>
          <p className="text-sm text-gray-500">
            LTP / volume for each strike from 5paisa Xstream{" "}
            <code className="text-gray-400">MarketFeedV3</code> via the gateway. Structure
            from REST; ticks on <code className="text-gray-400">ws://…/ws</code>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {["NIFTY", "BANKNIFTY"].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSymbol(s)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                symbol === s
                  ? "bg-violet-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
            >
              {s}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void refetch()}
            className="rounded-lg border border-gray-700 px-3 py-2 text-xs text-gray-400 hover:bg-gray-800"
          >
            Refresh chain
          </button>
        </div>
      </div>

      {!hasWs && (
        <div className="mb-4 rounded-lg border border-amber-800/50 bg-amber-950/20 px-4 py-3 text-sm text-amber-200/90">
          Set <code className="text-amber-100">NEXT_PUBLIC_XSTREAM_WS_URL</code> (e.g.{" "}
          <code className="text-amber-100">ws://127.0.0.1:3333/ws</code>) and run{" "}
          <code className="text-amber-100">xstream-ws-gateway</code> to enable live ticks.
        </div>
      )}

      {data?.error && (
        <div className="mb-4 text-sm text-red-400">Warning: {data.error}</div>
      )}

      {isLoading && (
        <p className="text-gray-500">Loading option chain and scrip map…</p>
      )}
      {error && (
        <p className="text-red-400">{(error as Error).message}</p>
      )}

      {data?.chain && !isLoading && (
        <>
          <div className="mb-4 flex flex-wrap gap-4 text-xs text-gray-500">
            <span>
              Spot:{" "}
              <span className="font-mono text-gray-200">
                {data.chain.spot.toFixed(2)}
              </span>
            </span>
            <span>Expiry: {data.chain.expiry}</span>
            <span>ATM: {data.chain.atmStrike}</span>
            <span>
              WS scrips: {data.wsInstruments?.length ?? 0} (capped; includes index + F&amp;O)
            </span>
            <span>
              Link:{" "}
              {hasWs && rt?.connection === "open" ? (
                <span className="text-emerald-500">connected</span>
              ) : (
                <span className="text-gray-500">disconnected</span>
              )}
            </span>
          </div>
          <OptionsChainTable
            chain={displayChain}
            spot={data.chain.spot}
            atmStrike={data.chain.atmStrike}
            maxCallOIStrike={data.chain.maxCallOIStrike}
            maxPutOIStrike={data.chain.maxPutOIStrike}
          />
        </>
      )}
    </div>
  );
}
