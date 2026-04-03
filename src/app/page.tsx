"use client";

import { useEngine } from "@/lib/hooks/useEngine";
import StatusBadge from "@/components/StatusBadge";

export default function Dashboard() {
  const { state, config, start, stop, toggleBot, closeAll, hydrated, hasCredentials } = useEngine();

  const isRunning = state.status === "running";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-[var(--muted)]">
            Přehled stavu bota a aktuálních pozic
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={state.status} />
          {!isRunning ? (
            <button
              onClick={start}
              disabled={!hasCredentials}
              className="px-4 py-2 bg-[var(--green)] text-white rounded-lg text-sm font-semibold
                disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition"
            >
              Spustit
            </button>
          ) : (
            <button
              onClick={stop}
              className="px-4 py-2 bg-[var(--red)] text-white rounded-lg text-sm font-semibold
                hover:brightness-110 transition"
            >
              Zastavit
            </button>
          )}
        </div>
      </div>

      {!hasCredentials && (
        <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-sm">
          Nejdříve nastav Binance API klíč v{" "}
          <a href="/settings" className="underline font-semibold">Nastavení</a>.
        </div>
      )}

      {state.error && (
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {state.error}
        </div>
      )}

      {/* Metriky */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Dnešní P&L"
          value={`${state.todayPnL >= 0 ? "+" : ""}${state.todayPnL.toFixed(2)}`}
          color={state.todayPnL >= 0 ? "var(--green)" : "var(--red)"}
        />
        <MetricCard
          label="Otevřené pozice"
          value={state.openPositions.length.toString()}
          color="var(--accent)"
        />
        <MetricCard
          label="Dnešní obchody"
          value={state.todayTrades.length.toString()}
          color="var(--foreground)"
        />
        <MetricCard
          label="Bot aktivní"
          value={config.active ? "ANO" : "NE"}
          color={config.active ? "var(--green)" : "var(--muted)"}
        />
      </div>

      {/* Ovládání */}
      <div className="flex gap-3">
        <button
          onClick={toggleBot}
          disabled={!isRunning}
          className={`px-4 py-2 rounded-lg text-sm font-semibold transition
            ${config.active
              ? "bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30"
              : "bg-green-500/20 text-green-400 hover:bg-green-500/30"
            }
            disabled:opacity-40 disabled:cursor-not-allowed`}
        >
          {config.active ? "Pozastavit trading" : "Aktivovat trading"}
        </button>
        {state.openPositions.length > 0 && (
          <button
            onClick={closeAll}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-500/20 text-red-400 hover:bg-red-500/30 transition"
          >
            Zavřít všechny pozice
          </button>
        )}
      </div>

      {/* Otevřené pozice */}
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--card-border)]">
          <h2 className="font-semibold">Otevřené pozice</h2>
        </div>
        {state.openPositions.length === 0 ? (
          <div className="p-8 text-center text-[var(--muted)] text-sm">
            Žádné otevřené pozice
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--muted)] text-xs">
                  <th className="px-4 py-2">Symbol</th>
                  <th className="px-4 py-2">Směr</th>
                  <th className="px-4 py-2">Volume</th>
                  <th className="px-4 py-2">Cena otevření</th>
                  <th className="px-4 py-2">SL</th>
                  <th className="px-4 py-2">TP</th>
                  <th className="px-4 py-2">P&L</th>
                </tr>
              </thead>
              <tbody>
                {state.openPositions.map((trade) => (
                  <tr key={trade.id} className="border-t border-[var(--card-border)]">
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
                    <td className="px-4 py-2 font-mono text-[var(--red)]">{trade.sl.toFixed(2)}</td>
                    <td className="px-4 py-2 font-mono text-[var(--green)]">{trade.tp.toFixed(2)}</td>
                    <td className="px-4 py-2 font-mono" style={{
                      color: (trade.profit || 0) >= 0 ? "var(--green)" : "var(--red)"
                    }}>
                      {(trade.profit || 0) >= 0 ? "+" : ""}{(trade.profit || 0).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Signály */}
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--card-border)]">
          <h2 className="font-semibold">Aktuální signály</h2>
        </div>
        {state.signals.length === 0 ? (
          <div className="p-8 text-center text-[var(--muted)] text-sm">
            Bot musí běžet pro generování signálů
          </div>
        ) : (
          <div className="divide-y divide-[var(--card-border)]">
            {state.signals.map((signal) => (
              <div key={signal.symbol} className="px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">{signal.symbol}</span>
                  <div className="flex items-center gap-2">
                    <span
                      className="px-2 py-0.5 rounded text-xs font-bold"
                      style={{
                        color: signal.type === "BUY" ? "var(--green)" : signal.type === "SELL" ? "var(--red)" : "var(--muted)",
                        background: signal.type === "BUY" ? "rgba(34,197,94,0.15)" : signal.type === "SELL" ? "rgba(239,68,68,0.15)" : "rgba(113,113,122,0.15)",
                      }}
                    >
                      {signal.type}
                    </span>
                    <span className="text-xs text-[var(--muted)]">
                      {(signal.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
                <div className="text-xs text-[var(--muted)] space-y-0.5">
                  {signal.reasons.map((r, i) => (
                    <div key={i}>• {r}</div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-4">
      <div className="text-xs text-[var(--muted)] mb-1">{label}</div>
      <div className="text-2xl font-bold font-mono" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
