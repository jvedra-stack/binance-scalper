"use client";

import { useState } from "react";
import EquityCurve from "@/components/EquityCurve";
import type { BacktestResult } from "@/lib/backtest/engine";

const SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT",
  "AVAXUSDT", "ADAUSDT", "LINKUSDT", "SUIUSDT", "PEPEUSDT",
  "ARBUSDT", "OPUSDT", "APTUSDT", "INJUSDT",
];

const INTERVALS = [
  { value: "1m", label: "1 min" },
  { value: "5m", label: "5 min" },
  { value: "15m", label: "15 min" },
  { value: "1h", label: "1 hod" },
  { value: "4h", label: "4 hod" },
];

const LIMITS = [
  { value: 200, label: "200 svicek" },
  { value: 500, label: "500 svicek" },
  { value: 1000, label: "1000 svicek" },
  { value: 1500, label: "1500 svicek" },
];

export default function BacktestPage() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setInterval_] = useState("5m");
  const [limit, setLimit] = useState(500);
  const [slPercent, setSlPercent] = useState(0.5);
  const [tpPercent, setTpPercent] = useState(0.35);
  const [minConfidence, setMinConfidence] = useState(0.45);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);

  const runBacktest = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/xtb/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          interval,
          limit,
          slPercent,
          tpPercent,
          config: { minConfidence },
        }),
      });

      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Chyba backtestu");
      } else {
        setResult(data.result);
      }
    } catch {
      setError("Nepodařilo se spustit backtest");
    }

    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Backtesting</h1>
        <p className="text-sm text-[var(--muted)]">Otestuj strategii na historických datech</p>
      </div>

      {/* Parametry */}
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-4">
        <h2 className="font-semibold mb-4">Parametry</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div>
            <label className="text-xs text-[var(--muted)] block mb-1">Symbol</label>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="w-full bg-[var(--background)] border border-[var(--card-border)] rounded px-2 py-1.5 text-sm"
            >
              {SYMBOLS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-[var(--muted)] block mb-1">Interval</label>
            <select
              value={interval}
              onChange={(e) => setInterval_(e.target.value)}
              className="w-full bg-[var(--background)] border border-[var(--card-border)] rounded px-2 py-1.5 text-sm"
            >
              {INTERVALS.map((iv) => (
                <option key={iv.value} value={iv.value}>{iv.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-[var(--muted)] block mb-1">Pocet svicek</label>
            <select
              value={limit}
              onChange={(e) => setLimit(parseInt(e.target.value))}
              className="w-full bg-[var(--background)] border border-[var(--card-border)] rounded px-2 py-1.5 text-sm"
            >
              {LIMITS.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-[var(--muted)] block mb-1">SL %</label>
            <input
              type="number"
              value={slPercent}
              onChange={(e) => setSlPercent(parseFloat(e.target.value))}
              step="0.1"
              min="0.1"
              max="5"
              className="w-full bg-[var(--background)] border border-[var(--card-border)] rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--muted)] block mb-1">TP %</label>
            <input
              type="number"
              value={tpPercent}
              onChange={(e) => setTpPercent(parseFloat(e.target.value))}
              step="0.1"
              min="0.1"
              max="5"
              className="w-full bg-[var(--background)] border border-[var(--card-border)] rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--muted)] block mb-1">Min Confidence</label>
            <input
              type="number"
              value={minConfidence}
              onChange={(e) => setMinConfidence(parseFloat(e.target.value))}
              step="0.05"
              min="0.1"
              max="1"
              className="w-full bg-[var(--background)] border border-[var(--card-border)] rounded px-2 py-1.5 text-sm"
            />
          </div>
        </div>

        <button
          onClick={runBacktest}
          disabled={loading}
          className="mt-4 px-6 py-2 rounded-lg bg-[var(--accent)] text-white font-semibold hover:bg-[var(--accent-hover)] transition-colors disabled:opacity-50"
        >
          {loading ? "Spouštím backtest..." : "Spustit backtest"}
        </button>

        {error && (
          <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}
      </div>

      {/* Výsledky */}
      {result && (
        <>
          {/* Metriky */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            <MetricCard
              label="Trades"
              value={result.totalTrades.toString()}
            />
            <MetricCard
              label="Win Rate"
              value={`${result.winRate.toFixed(1)}%`}
              color={result.winRate >= 50 ? "var(--green)" : "var(--red)"}
            />
            <MetricCard
              label="Zisk"
              value={`${result.totalProfit >= 0 ? "+" : ""}${result.totalProfit.toFixed(2)}`}
              color={result.totalProfit >= 0 ? "var(--green)" : "var(--red)"}
            />
            <MetricCard
              label="Avg Trade"
              value={`${result.avgProfit >= 0 ? "+" : ""}${result.avgProfit.toFixed(2)}`}
              color={result.avgProfit >= 0 ? "var(--green)" : "var(--red)"}
            />
            <MetricCard
              label="Max DD"
              value={`${result.maxDrawdownPercent.toFixed(1)}%`}
              color="var(--red)"
            />
            <MetricCard
              label="Profit Factor"
              value={result.profitFactor === Infinity ? "---" : result.profitFactor.toFixed(2)}
              color={result.profitFactor >= 1.5 ? "var(--green)" : result.profitFactor >= 1 ? "var(--yellow)" : "var(--red)"}
            />
            <MetricCard
              label="Sharpe"
              value={result.sharpeRatio.toFixed(2)}
              color={result.sharpeRatio >= 1 ? "var(--green)" : result.sharpeRatio >= 0 ? "var(--yellow)" : "var(--red)"}
            />
            <MetricCard
              label="W/L"
              value={`${result.wins}/${result.losses}`}
            />
          </div>

          {/* Equity Curve */}
          <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--card-border)]">
              <h2 className="font-semibold">Equity Curve</h2>
            </div>
            <EquityCurve data={result.equityCurve} initialCapital={1000} />
          </div>

          {/* Trade list */}
          <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--card-border)]">
              <h2 className="font-semibold">Obchody ({result.trades.length})</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-[var(--muted)] border-b border-[var(--card-border)]">
                    <th className="px-4 py-2 text-left">#</th>
                    <th className="px-4 py-2 text-left">Cas</th>
                    <th className="px-4 py-2 text-left">Smer</th>
                    <th className="px-4 py-2 text-right">Entry</th>
                    <th className="px-4 py-2 text-right">Exit</th>
                    <th className="px-4 py-2 text-right">P&L %</th>
                    <th className="px-4 py-2 text-right">P&L $</th>
                    <th className="px-4 py-2 text-left">Duvod</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--card-border)]">
                  {result.trades.map((trade, i) => (
                    <tr key={i} className="hover:bg-[var(--background)]">
                      <td className="px-4 py-2 text-[var(--muted)]">{i + 1}</td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {new Date(trade.entryTime).toLocaleString("cs")}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className="px-1.5 py-0.5 rounded text-xs font-bold"
                          style={{
                            color: trade.direction === "BUY" ? "var(--green)" : "var(--red)",
                            background: trade.direction === "BUY" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                          }}
                        >
                          {trade.direction}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right font-mono">{trade.entryPrice.toFixed(2)}</td>
                      <td className="px-4 py-2 text-right font-mono">{trade.exitPrice.toFixed(2)}</td>
                      <td
                        className="px-4 py-2 text-right font-mono"
                        style={{ color: trade.profitPercent >= 0 ? "var(--green)" : "var(--red)" }}
                      >
                        {trade.profitPercent >= 0 ? "+" : ""}{trade.profitPercent.toFixed(3)}%
                      </td>
                      <td
                        className="px-4 py-2 text-right font-mono font-semibold"
                        style={{ color: trade.profit >= 0 ? "var(--green)" : "var(--red)" }}
                      >
                        {trade.profit >= 0 ? "+" : ""}{trade.profit.toFixed(2)}
                      </td>
                      <td className="px-4 py-2 text-[var(--muted)] text-xs">{trade.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      {/* Optimization Grid */}
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-4">
        <h2 className="font-semibold mb-3">Parameter Optimization</h2>
        <p className="text-xs text-[var(--muted)] mb-3">Grid search pres kombinace SL/TP/Confidence pro nalezeni nejlepsich parametru</p>
        <OptimizationGrid symbol={symbol} interval={interval} limit={limit} />
      </div>

      {/* Multi-symbol Backtest */}
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-4">
        <h2 className="font-semibold mb-3">Multi-Symbol Backtest</h2>
        <p className="text-xs text-[var(--muted)] mb-3">Porovnej vykonnost strategie na vsech coinech naraz</p>
        <MultiSymbolBacktest interval={interval} limit={limit} slPercent={slPercent} tpPercent={tpPercent} minConfidence={minConfidence} />
      </div>
    </div>
  );
}

function OptimizationGrid({ symbol, interval, limit }: { symbol: string; interval: string; limit: number }) {
  const [results, setResults] = useState<Array<{ params: { sl: number; tp: number; conf: number }; totalTrades: number; winRate: number; totalProfit: number; profitFactor: number; maxDrawdownPercent: number }>>([]);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/xtb/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, interval, limit }),
      });
      const data = await res.json();
      if (data.ok) setResults(data.results);
    } catch { /* ok */ }
    setLoading(false);
  };

  return (
    <div>
      <button
        onClick={run}
        disabled={loading}
        className="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-semibold hover:bg-purple-700 transition disabled:opacity-50"
      >
        {loading ? "Optimalizuji..." : "Spustit optimalizaci"}
      </button>

      {results.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-[var(--muted)] border-b border-[var(--card-border)]">
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-right">SL %</th>
                <th className="px-3 py-2 text-right">TP %</th>
                <th className="px-3 py-2 text-right">Min Conf</th>
                <th className="px-3 py-2 text-right">Trades</th>
                <th className="px-3 py-2 text-right">Win Rate</th>
                <th className="px-3 py-2 text-right">P&L</th>
                <th className="px-3 py-2 text-right">PF</th>
                <th className="px-3 py-2 text-right">Max DD</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--card-border)]">
              {results.map((r, i) => (
                <tr key={i} className={`hover:bg-[var(--background)] ${i === 0 ? "bg-green-500/5" : ""}`}>
                  <td className="px-3 py-2 text-[var(--muted)]">{i + 1}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.params.sl}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.params.tp}</td>
                  <td className="px-3 py-2 text-right font-mono">{r.params.conf}</td>
                  <td className="px-3 py-2 text-right">{r.totalTrades}</td>
                  <td className="px-3 py-2 text-right" style={{ color: r.winRate >= 50 ? "var(--green)" : "var(--red)" }}>
                    {r.winRate.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold" style={{ color: r.totalProfit >= 0 ? "var(--green)" : "var(--red)" }}>
                    {r.totalProfit >= 0 ? "+" : ""}{r.totalProfit.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono" style={{ color: r.profitFactor >= 1.5 ? "var(--green)" : r.profitFactor >= 1 ? "var(--yellow)" : "var(--red)" }}>
                    {r.profitFactor === Infinity ? "---" : r.profitFactor.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[var(--red)]">{r.maxDrawdownPercent.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MultiSymbolBacktest({ interval, limit, slPercent, tpPercent, minConfidence }: {
  interval: string; limit: number; slPercent: number; tpPercent: number; minConfidence: number;
}) {
  const [results, setResults] = useState<Array<{ symbol: string; totalTrades: number; winRate: number; totalProfit: number; profitFactor: number; maxDrawdownPercent: number }>>([]);
  const [summary, setSummary] = useState<{ totalTrades: number; totalProfit: number; avgWinRate: number; symbols: number } | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/xtb/backtest-multi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval, limit, slPercent, tpPercent, config: { minConfidence } }),
      });
      const data = await res.json();
      if (data.ok) {
        setResults(data.results);
        setSummary(data.summary);
      }
    } catch { /* ok */ }
    setLoading(false);
  };

  return (
    <div>
      <button
        onClick={run}
        disabled={loading}
        className="px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 transition disabled:opacity-50"
      >
        {loading ? "Testuji vsechny coiny..." : "Spustit multi-symbol backtest"}
      </button>

      {summary && (
        <div className="mt-4 grid grid-cols-4 gap-3">
          <div className="rounded-lg bg-[var(--background)] p-3">
            <div className="text-xs text-[var(--muted)]">Symboly</div>
            <div className="font-bold">{summary.symbols}</div>
          </div>
          <div className="rounded-lg bg-[var(--background)] p-3">
            <div className="text-xs text-[var(--muted)]">Celkem tradu</div>
            <div className="font-bold">{summary.totalTrades}</div>
          </div>
          <div className="rounded-lg bg-[var(--background)] p-3">
            <div className="text-xs text-[var(--muted)]">Avg Win Rate</div>
            <div className="font-bold" style={{ color: summary.avgWinRate >= 50 ? "var(--green)" : "var(--red)" }}>{summary.avgWinRate.toFixed(1)}%</div>
          </div>
          <div className="rounded-lg bg-[var(--background)] p-3">
            <div className="text-xs text-[var(--muted)]">Celkovy P&L</div>
            <div className="font-bold font-mono" style={{ color: summary.totalProfit >= 0 ? "var(--green)" : "var(--red)" }}>
              {summary.totalProfit >= 0 ? "+" : ""}{summary.totalProfit.toFixed(2)}
            </div>
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-[var(--muted)] border-b border-[var(--card-border)]">
                <th className="px-3 py-2 text-left">Symbol</th>
                <th className="px-3 py-2 text-right">Trades</th>
                <th className="px-3 py-2 text-right">Win Rate</th>
                <th className="px-3 py-2 text-right">P&L</th>
                <th className="px-3 py-2 text-right">PF</th>
                <th className="px-3 py-2 text-right">Max DD</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--card-border)]">
              {results.map((r) => (
                <tr key={r.symbol} className="hover:bg-[var(--background)]">
                  <td className="px-3 py-2 font-medium">{r.symbol}</td>
                  <td className="px-3 py-2 text-right">{r.totalTrades}</td>
                  <td className="px-3 py-2 text-right" style={{ color: r.winRate >= 50 ? "var(--green)" : "var(--red)" }}>
                    {r.winRate.toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold" style={{ color: r.totalProfit >= 0 ? "var(--green)" : "var(--red)" }}>
                    {r.totalProfit >= 0 ? "+" : ""}{r.totalProfit.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono" style={{ color: r.profitFactor >= 1.5 ? "var(--green)" : r.profitFactor >= 1 ? "var(--yellow)" : "var(--red)" }}>
                    {r.profitFactor === Infinity ? "---" : r.profitFactor.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[var(--red)]">{r.maxDrawdownPercent.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] p-3">
      <div className="text-xs text-[var(--muted)] mb-1">{label}</div>
      <div className="font-mono font-bold text-lg" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
