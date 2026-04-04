"use client";

import { useState, useEffect } from "react";
import type { Trade } from "@/types";

export default function TradesPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [filter, setFilter] = useState<"all" | "open" | "closed">("all");

  useEffect(() => {
    async function fetchTrades() {
      try {
        const res = await fetch("/api/xtb/state");
        if (res.ok) {
          const data = await res.json();
          setTrades(data.trades || []);
        }
      } catch { /* ok */ }
    }
    fetchTrades();
    const interval = setInterval(fetchTrades, 5000);
    return () => clearInterval(interval);
  }, []);

  const filtered = trades
    .filter((t) => filter === "all" || t.status === filter)
    .sort((a, b) => b.openTime - a.openTime);

  const totalPnL = trades
    .filter((t) => t.status === "closed" && t.profit !== undefined)
    .reduce((sum, t) => sum + (t.profit || 0), 0);

  const winRate = (() => {
    const closed = trades.filter((t) => t.status === "closed" && t.profit !== undefined);
    if (closed.length === 0) return 0;
    const wins = closed.filter((t) => (t.profit || 0) > 0).length;
    return (wins / closed.length) * 100;
  })();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Historie obchodů</h1>
          <p className="text-sm text-[var(--muted)]">
            {trades.length} obchodů celkem | Win rate: {winRate.toFixed(1)}%
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-[var(--muted)]">Celkový P&L</div>
          <div
            className="text-xl font-bold font-mono"
            style={{ color: totalPnL >= 0 ? "var(--green)" : "var(--red)" }}
          >
            {totalPnL >= 0 ? "+" : ""}{totalPnL.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Filtr */}
      <div className="flex gap-2">
        {(["all", "open", "closed"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition
              ${filter === f
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--muted)] hover:bg-[var(--card)]"
              }`}
          >
            {f === "all" ? "Všechny" : f === "open" ? "Otevřené" : "Zavřené"}
          </button>
        ))}
      </div>

      {/* Tabulka */}
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-[var(--muted)] text-sm">
            Žádné obchody
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--muted)] text-xs border-b border-[var(--card-border)]">
                  <th className="px-4 py-2">Čas</th>
                  <th className="px-4 py-2">Symbol</th>
                  <th className="px-4 py-2">Směr</th>
                  <th className="px-4 py-2">Vol</th>
                  <th className="px-4 py-2">Otevření</th>
                  <th className="px-4 py-2">Zavření</th>
                  <th className="px-4 py-2">P&L</th>
                  <th className="px-4 py-2">Stav</th>
                  <th className="px-4 py-2">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((trade) => (
                  <tr key={trade.id} className="border-t border-[var(--card-border)] hover:bg-[var(--background)]/50">
                    <td className="px-4 py-2 text-xs text-[var(--muted)]">
                      {new Date(trade.openTime).toLocaleString("cs")}
                    </td>
                    <td className="px-4 py-2 font-medium">{trade.symbol}</td>
                    <td className="px-4 py-2">
                      <span
                        className="px-2 py-0.5 rounded text-xs font-bold"
                        style={{
                          color: trade.direction === "BUY" ? "var(--green)" : "var(--red)",
                          background: trade.direction === "BUY" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                        }}
                      >
                        {trade.direction}
                      </span>
                    </td>
                    <td className="px-4 py-2">{trade.volume}</td>
                    <td className="px-4 py-2 font-mono">{trade.openPrice.toFixed(2)}</td>
                    <td className="px-4 py-2 font-mono">
                      {trade.closePrice ? trade.closePrice.toFixed(2) : "—"}
                    </td>
                    <td className="px-4 py-2 font-mono" style={{
                      color: trade.profit !== undefined
                        ? trade.profit >= 0 ? "var(--green)" : "var(--red)"
                        : "var(--muted)"
                    }}>
                      {trade.profit !== undefined
                        ? `${trade.profit >= 0 ? "+" : ""}${trade.profit.toFixed(2)}`
                        : "—"}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`text-xs ${trade.status === "open" ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}>
                        {trade.status === "open" ? "Otevřený" : "Zavřený"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-[var(--muted)]">
                      {(trade.signal.confidence * 100).toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
