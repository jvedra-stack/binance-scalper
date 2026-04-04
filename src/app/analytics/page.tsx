"use client";

import { useState, useEffect, useMemo } from "react";
import EquityCurve from "@/components/EquityCurve";
import type { Trade } from "@/types";

export default function AnalyticsPage() {
  const [trades, setTrades] = useState<Trade[]>([]);

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
  }, []);

  const closedTrades = useMemo(
    () => trades.filter((t) => t.status === "closed" && t.profit !== undefined).sort((a, b) => a.openTime - b.openTime),
    [trades]
  );

  // Equity curve z reálných tradů
  const equityCurve = useMemo(() => {
    let equity = 1000;
    return closedTrades.map((t) => {
      equity += t.profit || 0;
      return { time: t.closeTime || t.openTime, equity };
    });
  }, [closedTrades]);

  // Statistiky
  const stats = useMemo(() => {
    if (closedTrades.length === 0) return null;

    const wins = closedTrades.filter((t) => (t.profit || 0) > 0);
    const losses = closedTrades.filter((t) => (t.profit || 0) <= 0);
    const totalPnL = closedTrades.reduce((s, t) => s + (t.profit || 0), 0);
    const grossProfit = wins.reduce((s, t) => s + (t.profit || 0), 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.profit || 0), 0));
    const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
    const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;

    // Max drawdown
    let maxEquity = 1000, equity = 1000, maxDD = 0;
    for (const t of closedTrades) {
      equity += t.profit || 0;
      maxEquity = Math.max(maxEquity, equity);
      maxDD = Math.max(maxDD, maxEquity - equity);
    }

    // Streak
    let maxWinStreak = 0, maxLossStreak = 0, ws = 0, ls = 0;
    for (const t of closedTrades) {
      if ((t.profit || 0) > 0) { ws++; ls = 0; maxWinStreak = Math.max(maxWinStreak, ws); }
      else { ls++; ws = 0; maxLossStreak = Math.max(maxLossStreak, ls); }
    }

    // Per-hodina
    const hourStats = Array.from({ length: 24 }, () => ({ trades: 0, pnl: 0, wins: 0 }));
    for (const t of closedTrades) {
      const h = new Date(t.openTime).getHours();
      hourStats[h].trades++;
      hourStats[h].pnl += t.profit || 0;
      if ((t.profit || 0) > 0) hourStats[h].wins++;
    }

    // Per-symbol
    const symbolMap = new Map<string, { trades: number; pnl: number; wins: number }>();
    for (const t of closedTrades) {
      const s = symbolMap.get(t.symbol) || { trades: 0, pnl: 0, wins: 0 };
      s.trades++;
      s.pnl += t.profit || 0;
      if ((t.profit || 0) > 0) s.wins++;
      symbolMap.set(t.symbol, s);
    }

    // Per-den
    const dayMap = new Map<string, { trades: number; pnl: number; wins: number }>();
    for (const t of closedTrades) {
      const d = new Date(t.openTime).toLocaleDateString("cs");
      const s = dayMap.get(d) || { trades: 0, pnl: 0, wins: 0 };
      s.trades++;
      s.pnl += t.profit || 0;
      if ((t.profit || 0) > 0) s.wins++;
      dayMap.set(d, s);
    }

    return {
      totalTrades: closedTrades.length,
      winRate: (wins.length / closedTrades.length) * 100,
      totalPnL,
      avgWin,
      avgLoss,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : Infinity,
      maxDrawdown: maxDD,
      maxWinStreak,
      maxLossStreak,
      hourStats,
      symbolStats: Array.from(symbolMap.entries()).sort((a, b) => b[1].pnl - a[1].pnl),
      dayStats: Array.from(dayMap.entries()),
    };
  }, [closedTrades]);

  // CSV export
  const exportCSV = () => {
    const bom = "\uFEFF";
    const header = "Datum;Symbol;Smer;Volume;Otevreni;Zavreni;SL;TP;P&L;Confidence;Stav\n";
    const rows = trades
      .sort((a, b) => b.openTime - a.openTime)
      .map((t) => [
        new Date(t.openTime).toLocaleString("cs"),
        t.symbol,
        t.direction,
        t.volume,
        t.openPrice.toFixed(2),
        t.closePrice?.toFixed(2) || "",
        t.sl.toFixed(2),
        t.tp.toFixed(2),
        t.profit?.toFixed(2) || "",
        (t.signal.confidence * 100).toFixed(0) + "%",
        t.status,
      ].join(";"))
      .join("\n");

    const blob = new Blob([bom + header + rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trades_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Performance Analytics</h1>
          <p className="text-sm text-[var(--muted)]">Detailni analyza obchodovani</p>
        </div>
        <button
          onClick={exportCSV}
          disabled={trades.length === 0}
          className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-semibold hover:bg-[var(--accent-hover)] transition disabled:opacity-40"
        >
          Export CSV
        </button>
      </div>

      {!stats ? (
        <div className="p-8 text-center text-[var(--muted)] text-sm rounded-xl border border-[var(--card-border)] bg-[var(--card)]">
          Zadne uzavrene obchody pro analyzu
        </div>
      ) : (
        <>
          {/* Hlavní metriky */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            <MetricCard label="Trades" value={stats.totalTrades.toString()} />
            <MetricCard label="Win Rate" value={`${stats.winRate.toFixed(1)}%`} color={stats.winRate >= 50 ? "var(--green)" : "var(--red)"} />
            <MetricCard label="P&L" value={`${stats.totalPnL >= 0 ? "+" : ""}${stats.totalPnL.toFixed(2)}`} color={stats.totalPnL >= 0 ? "var(--green)" : "var(--red)"} />
            <MetricCard label="Avg Win" value={`+${stats.avgWin.toFixed(2)}`} color="var(--green)" />
            <MetricCard label="Avg Loss" value={`-${stats.avgLoss.toFixed(2)}`} color="var(--red)" />
            <MetricCard label="Profit Factor" value={stats.profitFactor === Infinity ? "---" : stats.profitFactor.toFixed(2)} color={stats.profitFactor >= 1.5 ? "var(--green)" : "var(--red)"} />
            <MetricCard label="Max DD" value={stats.maxDrawdown.toFixed(2)} color="var(--red)" />
            <MetricCard label="Win/Loss Streak" value={`${stats.maxWinStreak}/${stats.maxLossStreak}`} />
          </div>

          {/* Equity Curve */}
          {equityCurve.length > 1 && (
            <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--card-border)]">
                <h2 className="font-semibold">Equity Curve (realne obchody)</h2>
              </div>
              <EquityCurve data={equityCurve} initialCapital={1000} />
            </div>
          )}

          {/* Heatmapa hodin */}
          <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--card-border)]">
              <h2 className="font-semibold">P&L podle hodiny</h2>
            </div>
            <div className="p-4">
              <div className="flex gap-1">
                {stats.hourStats.map((h, i) => {
                  const maxPnl = Math.max(...stats.hourStats.map((x) => Math.abs(x.pnl)), 1);
                  const intensity = Math.min(1, Math.abs(h.pnl) / maxPnl);
                  const bg = h.trades === 0
                    ? "rgba(113,113,122,0.1)"
                    : h.pnl >= 0
                      ? `rgba(34,197,94,${0.15 + intensity * 0.6})`
                      : `rgba(239,68,68,${0.15 + intensity * 0.6})`;
                  return (
                    <div
                      key={i}
                      className="flex-1 rounded text-center py-2"
                      style={{ background: bg }}
                      title={`${i}:00 — ${h.trades} tradu, P&L: ${h.pnl.toFixed(2)}, WR: ${h.trades > 0 ? ((h.wins / h.trades) * 100).toFixed(0) : 0}%`}
                    >
                      <div className="text-[10px] text-[var(--muted)]">{i}h</div>
                      <div className="text-xs font-mono font-semibold" style={{ color: h.pnl >= 0 ? "var(--green)" : "var(--red)" }}>
                        {h.trades > 0 ? (h.pnl >= 0 ? "+" : "") + h.pnl.toFixed(1) : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Per-symbol statistiky */}
          <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--card-border)]">
              <h2 className="font-semibold">Vykonnost podle symbolu</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-[var(--muted)] border-b border-[var(--card-border)]">
                    <th className="px-4 py-2 text-left">Symbol</th>
                    <th className="px-4 py-2 text-right">Trades</th>
                    <th className="px-4 py-2 text-right">Win Rate</th>
                    <th className="px-4 py-2 text-right">P&L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--card-border)]">
                  {stats.symbolStats.map(([symbol, s]) => (
                    <tr key={symbol} className="hover:bg-[var(--background)]">
                      <td className="px-4 py-2 font-medium">{symbol}</td>
                      <td className="px-4 py-2 text-right">{s.trades}</td>
                      <td className="px-4 py-2 text-right" style={{ color: s.trades > 0 && s.wins / s.trades >= 0.5 ? "var(--green)" : "var(--red)" }}>
                        {s.trades > 0 ? ((s.wins / s.trades) * 100).toFixed(0) : 0}%
                      </td>
                      <td className="px-4 py-2 text-right font-mono font-semibold" style={{ color: s.pnl >= 0 ? "var(--green)" : "var(--red)" }}>
                        {s.pnl >= 0 ? "+" : ""}{s.pnl.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Denní P&L */}
          <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--card-border)]">
              <h2 className="font-semibold">Denni P&L</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-[var(--muted)] border-b border-[var(--card-border)]">
                    <th className="px-4 py-2 text-left">Den</th>
                    <th className="px-4 py-2 text-right">Trades</th>
                    <th className="px-4 py-2 text-right">Win Rate</th>
                    <th className="px-4 py-2 text-right">P&L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--card-border)]">
                  {stats.dayStats.map(([day, s]) => (
                    <tr key={day} className="hover:bg-[var(--background)]">
                      <td className="px-4 py-2">{day}</td>
                      <td className="px-4 py-2 text-right">{s.trades}</td>
                      <td className="px-4 py-2 text-right" style={{ color: s.trades > 0 && s.wins / s.trades >= 0.5 ? "var(--green)" : "var(--red)" }}>
                        {s.trades > 0 ? ((s.wins / s.trades) * 100).toFixed(0) : 0}%
                      </td>
                      <td className="px-4 py-2 text-right font-mono font-semibold" style={{ color: s.pnl >= 0 ? "var(--green)" : "var(--red)" }}>
                        {s.pnl >= 0 ? "+" : ""}{s.pnl.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] p-3">
      <div className="text-xs text-[var(--muted)] mb-1">{label}</div>
      <div className="font-mono font-bold text-lg" style={{ color }}>{value}</div>
    </div>
  );
}
