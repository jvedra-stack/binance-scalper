"use client";

import { useState } from "react";
import { useEngine } from "@/lib/hooks/useEngine";
import CandlestickChart from "@/components/CandlestickChart";

export default function LivePage() {
  const { state, config, closePosition } = useEngine();
  const [chartSymbol, setChartSymbol] = useState<{ symbol: string; label: string } | null>(null);

  const isRunning = state.status === "running";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Live View</h1>
        <p className="text-sm text-[var(--muted)]">Real-time ceny, indikátory a signály — klikni na instrument pro graf</p>
      </div>

      {/* Chart Modal */}
      {chartSymbol && (
        <CandlestickChart
          symbol={chartSymbol.symbol}
          label={chartSymbol.label}
          onClose={() => setChartSymbol(null)}
        />
      )}

      {!isRunning && (
        <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-sm">
          Bot musí běžet pro zobrazení live dat. Spusť ho na <a href="/" className="underline font-semibold">Dashboardu</a>. Připoj se v <a href="/settings" className="underline font-semibold">Nastavení</a>.
        </div>
      )}

      {/* Live ceny */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {config.instruments.filter((i) => i.enabled).map((instrument) => {
          const tick = state.lastTick?.[instrument.symbol];
          const signal = state.signals.find((s) => s.symbol === instrument.symbol);

          return (
            <div
              key={instrument.symbol}
              className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-4 cursor-pointer hover:border-[var(--accent)] transition-colors"
              onClick={() => setChartSymbol({ symbol: instrument.symbol, label: instrument.label })}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">{instrument.label}</h3>
                {signal && (
                  <span
                    className="px-2 py-0.5 rounded text-xs font-bold"
                    style={{
                      color: signal.type === "BUY" ? "var(--green)" : signal.type === "SELL" ? "var(--red)" : "var(--muted)",
                      background: signal.type === "BUY" ? "rgba(34,197,94,0.15)" : signal.type === "SELL" ? "rgba(239,68,68,0.15)" : "rgba(113,113,122,0.15)",
                    }}
                  >
                    {signal.type} {(signal.confidence * 100).toFixed(0)}%
                  </span>
                )}
              </div>

              {tick ? (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--muted)]">Cena</span>
                    <span className="font-mono font-semibold">{tick.lastPrice.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--muted)]">Bid</span>
                    <span className="font-mono text-[var(--red)]">{tick.bid1Price.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--muted)]">Ask</span>
                    <span className="font-mono text-[var(--green)]">{tick.ask1Price.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--muted)]">24h High</span>
                    <span className="font-mono">{tick.highPrice24h.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--muted)]">24h Low</span>
                    <span className="font-mono">{tick.lowPrice24h.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--muted)]">24h Change</span>
                    <span className="font-mono" style={{ color: tick.price24hPcnt >= 0 ? "var(--green)" : "var(--red)" }}>
                      {(tick.price24hPcnt * 100).toFixed(2)}%
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-[var(--muted)]">Čekám na data...</div>
              )}

              {/* Indikátory */}
              {signal && signal.indicators.emaFast > 0 && (
                <div className="mt-3 pt-3 border-t border-[var(--card-border)] space-y-1">
                  <div className="text-xs text-[var(--muted)] font-semibold mb-1">Indikátory</div>
                  <IndicatorBar label="RSI" value={signal.indicators.rsi} min={0} max={100}
                    color={signal.indicators.rsi > 70 ? "var(--red)" : signal.indicators.rsi < 30 ? "var(--green)" : "var(--accent)"} />
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--muted)]">EMA{config.strategy.emaFastPeriod}</span>
                    <span className="font-mono">{signal.indicators.emaFast.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--muted)]">EMA{config.strategy.emaSlowPeriod}</span>
                    <span className="font-mono">{signal.indicators.emaSlow.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--muted)]">BB Upper</span>
                    <span className="font-mono">{signal.indicators.bbUpper.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--muted)]">BB Lower</span>
                    <span className="font-mono">{signal.indicators.bbLower.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--muted)]">ATR</span>
                    <span className="font-mono">{signal.indicators.atr.toFixed(4)}</span>
                  </div>
                </div>
              )}

              {/* Důvody signálu */}
              {signal && signal.reasons.length > 0 && (
                <div className="mt-3 pt-3 border-t border-[var(--card-border)]">
                  <div className="text-xs text-[var(--muted)] font-semibold mb-1">Signál</div>
                  <div className="text-xs text-[var(--muted)] space-y-0.5">
                    {signal.reasons.map((r, i) => (
                      <div key={i}>• {r}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Otevřené pozice s možností zavření */}
      {state.openPositions.length > 0 && (
        <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] overflow-hidden">
          <div className="px-4 py-3 border-b border-[var(--card-border)]">
            <h2 className="font-semibold">Otevřené pozice</h2>
          </div>
          <div className="divide-y divide-[var(--card-border)]">
            {state.openPositions.map((trade) => {
              const tick = state.lastTick?.[trade.symbol];
              const currentPrice = tick
                ? trade.direction === "BUY" ? tick.bid1Price : tick.ask1Price
                : undefined;
              const livePnL = currentPrice
                ? trade.direction === "BUY"
                  ? (currentPrice - trade.openPrice) * trade.volume
                  : (trade.openPrice - currentPrice) * trade.volume
                : trade.profit || 0;

              return (
                <div key={trade.id} className="px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className="font-medium">{trade.symbol}</span>
                    <span
                      className="px-2 py-0.5 rounded text-xs font-bold"
                      style={{
                        color: trade.direction === "BUY" ? "var(--green)" : "var(--red)",
                        background: trade.direction === "BUY" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
                      }}
                    >
                      {trade.direction}
                    </span>
                    <span className="text-sm text-[var(--muted)]">{trade.volume} lot</span>
                    <span className="text-sm font-mono">{trade.openPrice.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span
                      className="font-mono font-semibold"
                      style={{ color: livePnL >= 0 ? "var(--green)" : "var(--red)" }}
                    >
                      {livePnL >= 0 ? "+" : ""}{livePnL.toFixed(2)}
                    </span>
                    <button
                      onClick={() => closePosition(trade.symbol, trade.direction)}
                      className="px-3 py-1 rounded text-xs font-semibold bg-red-500/20 text-red-400 hover:bg-red-500/30 transition"
                    >
                      Zavřít
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function IndicatorBar({ label, value, min, max, color }: {
  label: string; value: number; min: number; max: number; color: string;
}) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return (
    <div>
      <div className="flex justify-between text-xs mb-0.5">
        <span className="text-[var(--muted)]">{label}</span>
        <span className="font-mono" style={{ color }}>{value.toFixed(1)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--background)]">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}
