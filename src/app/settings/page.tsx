"use client";

import { useState } from "react";
import { useEngine } from "@/lib/hooks/useEngine";
import type { InstrumentConfig } from "@/types";

interface BacktestResult {
  symbol: string;
  label: string;
  totalTrades: number;
  winRate: number;
  totalProfit: number;
  maxDrawdown: number;
  score: number;
  bestConfig: { emaFastPeriod: number; emaSlowPeriod: number; rsiPeriod: number; rsiOversold: number; rsiOverbought: number; bbPeriod: number; bbStdDev: number };
}

export default function SettingsPage() {
  const { config, updateConfig, hydrated } = useEngine();
  const [autoProgress, setAutoProgress] = useState<string | null>(null);
  const [autoRunning, setAutoRunning] = useState(false);
  const [backtestResults, setBacktestResults] = useState<BacktestResult[]>([]);
  const [autoError, setAutoError] = useState<string | null>(null);
  const [autoBalance, setAutoBalance] = useState<number | null>(null);

  const hasCredentials = !!config.credentials.apiKey && !!config.credentials.apiSecret;

  async function handleAutoSetup() {
    if (!hasCredentials) return;
    setAutoError(null);
    setBacktestResults([]);
    setAutoRunning(true);
    setAutoProgress("Připojuji se k Binance a spouštím backtest...");

    try {
      const res = await fetch("/api/xtb/auto-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials: config.credentials }),
      });

      const data = await res.json();

      if (!data.ok) {
        setAutoError(data.error);
        setAutoProgress(null);
        setAutoRunning(false);
        return;
      }

      updateConfig({
        instruments: data.instruments,
        strategy: data.strategy,
        risk: data.risk,
      });

      setBacktestResults(data.backtestResults);
      setAutoBalance(data.balance);
      setAutoProgress("Auto-setup dokončen!");
    } catch (err) {
      setAutoError(err instanceof Error ? err.message : "Neznámá chyba");
      setAutoProgress(null);
    }
    setAutoRunning(false);
  }

  if (!hydrated) {
    return (
      <div className="space-y-6 max-w-3xl">
        <h1 className="text-2xl font-bold">Nastavení</h1>
        <p className="text-sm text-[var(--muted)]">Načítání...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Nastavení</h1>
        <p className="text-sm text-[var(--muted)]">Konfigurace bota, připojení a risk managementu</p>
      </div>

      {/* Binance Připojení */}
      <Section title="Binance Připojení">
        <div className="grid grid-cols-1 gap-4">
          <Input
            label="API Key"
            type="text"
            value={config.credentials.apiKey}
            onChange={(v) => updateConfig({ credentials: { ...config.credentials, apiKey: v } })}
            placeholder="Tvůj Binance API Key"
          />
          <Input
            label="API Secret"
            type="password"
            value={config.credentials.apiSecret}
            onChange={(v) => updateConfig({ credentials: { ...config.credentials, apiSecret: v } })}
            placeholder="Tvůj Binance API Secret"
          />
        </div>
        <div className="mt-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={config.credentials.testnet}
              onChange={(e) => updateConfig({ credentials: { ...config.credentials, testnet: e.target.checked } })}
              className="w-4 h-4 rounded"
            />
            <span>Testnet</span>
            {!config.credentials.testnet && (
              <span className="text-xs text-[var(--red)] font-semibold ml-2">REAL ÚČET</span>
            )}
          </label>
          <p className="text-xs text-[var(--muted)] mt-1">
            API klíč vygeneruješ v Binance &rarr; Account &rarr; API Management
          </p>
        </div>
      </Section>

      {/* Auto-Setup */}
      <Section title="Auto-Setup">
        <p className="text-sm text-[var(--muted)] mb-4">
          Naskenuje top krypto páry, otestuje strategie na historických datech a nastaví optimální konfiguraci.
        </p>

        <button
          onClick={handleAutoSetup}
          disabled={!hasCredentials || autoRunning}
          className="w-full px-4 py-3 bg-[var(--accent)] text-white rounded-lg text-sm font-semibold
            disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--accent-hover)] transition"
        >
          {autoRunning ? "Probíhá..." : "Spustit Auto-Setup"}
        </button>

        {autoProgress && (
          <div className={`mt-3 text-sm ${autoError ? "text-[var(--red)]" : "text-[var(--green)]"}`}>
            {autoProgress}
          </div>
        )}

        {autoBalance !== null && (
          <div className="mt-2 text-sm text-[var(--muted)]">
            Zůstatek účtu: <span className="font-mono font-semibold text-[var(--foreground)]">{autoBalance.toFixed(2)} USDT</span>
          </div>
        )}

        {autoError && (
          <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm whitespace-pre-wrap">
            {autoError}
          </div>
        )}

        {backtestResults.length > 0 && (
          <div className="mt-4 space-y-3">
            <h3 className="text-sm font-semibold text-[var(--muted)]">Výsledky backtestu</h3>
            {backtestResults.map((result, idx) => (
              <div
                key={result.symbol}
                className={`p-3 rounded-lg border ${
                  idx < 3 ? "border-[var(--accent)]/50 bg-[var(--accent)]/5" : "border-[var(--card-border)] bg-[var(--background)]"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {idx < 3 && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--accent)]/20 text-[var(--accent)] font-bold">
                        TOP {idx + 1}
                      </span>
                    )}
                    <span className="font-medium text-sm">{result.label}</span>
                    <span className="text-xs text-[var(--muted)]">({result.symbol})</span>
                  </div>
                  <span className="text-xs font-mono text-[var(--muted)]">
                    Score: {result.score.toFixed(3)}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div>
                    <span className="text-[var(--muted)]">Obchody</span>
                    <div className="font-mono font-semibold">{result.totalTrades}</div>
                  </div>
                  <div>
                    <span className="text-[var(--muted)]">Win rate</span>
                    <div className="font-mono font-semibold" style={{ color: result.winRate >= 50 ? "var(--green)" : "var(--red)" }}>
                      {result.winRate.toFixed(1)}%
                    </div>
                  </div>
                  <div>
                    <span className="text-[var(--muted)]">Profit</span>
                    <div className="font-mono font-semibold" style={{ color: result.totalProfit >= 0 ? "var(--green)" : "var(--red)" }}>
                      {result.totalProfit >= 0 ? "+" : ""}{result.totalProfit.toFixed(4)}
                    </div>
                  </div>
                  <div>
                    <span className="text-[var(--muted)]">Max DD</span>
                    <div className="font-mono font-semibold text-[var(--red)]">
                      -{result.maxDrawdown.toFixed(4)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Instrumenty */}
      <Section title="Instrumenty">
        <div className="space-y-3">
          {config.instruments.map((inst, idx) => (
            <InstrumentRow
              key={inst.symbol}
              instrument={inst}
              onChange={(updated) => {
                const instruments = [...config.instruments];
                instruments[idx] = updated;
                updateConfig({ instruments });
              }}
            />
          ))}
        </div>
      </Section>

      {/* Strategie */}
      <Section title="Strategie">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Input label="EMA Fast" type="number" value={config.strategy.emaFastPeriod.toString()} onChange={(v) => updateConfig({ strategy: { ...config.strategy, emaFastPeriod: parseInt(v) || 9 } })} />
          <Input label="EMA Slow" type="number" value={config.strategy.emaSlowPeriod.toString()} onChange={(v) => updateConfig({ strategy: { ...config.strategy, emaSlowPeriod: parseInt(v) || 21 } })} />
          <Input label="RSI perioda" type="number" value={config.strategy.rsiPeriod.toString()} onChange={(v) => updateConfig({ strategy: { ...config.strategy, rsiPeriod: parseInt(v) || 14 } })} />
          <Input label="RSI Overbought" type="number" value={config.strategy.rsiOverbought.toString()} onChange={(v) => updateConfig({ strategy: { ...config.strategy, rsiOverbought: parseInt(v) || 70 } })} />
          <Input label="RSI Oversold" type="number" value={config.strategy.rsiOversold.toString()} onChange={(v) => updateConfig({ strategy: { ...config.strategy, rsiOversold: parseInt(v) || 30 } })} />
          <Input label="Min. confidence" type="number" value={config.strategy.minConfidence.toString()} onChange={(v) => updateConfig({ strategy: { ...config.strategy, minConfidence: parseFloat(v) || 0.6 } })} />
        </div>
      </Section>

      {/* Risk Management */}
      <Section title="Risk Management">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Input label="Max otevřených pozic" type="number" value={config.risk.maxOpenPositions.toString()} onChange={(v) => updateConfig({ risk: { ...config.risk, maxOpenPositions: parseInt(v) || 2 } })} />
          <Input label="Max denní ztráta (USDT)" type="number" value={config.risk.maxDailyLoss.toString()} onChange={(v) => updateConfig({ risk: { ...config.risk, maxDailyLoss: parseFloat(v) || 50 } })} />
          <Input label="Max denních tradů" type="number" value={config.risk.maxDailyTrades.toString()} onChange={(v) => updateConfig({ risk: { ...config.risk, maxDailyTrades: parseInt(v) || 20 } })} />
        </div>
        <div className="mt-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={config.risk.trailingStop} onChange={(e) => updateConfig({ risk: { ...config.risk, trailingStop: e.target.checked } })} className="w-4 h-4 rounded" />
            Trailing Stop
          </label>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-5">
      <h2 className="font-semibold mb-4">{title}</h2>
      {children}
    </div>
  );
}

function Input({ label, type, value, onChange, placeholder }: { label: string; type: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-xs text-[var(--muted)] mb-1">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm focus:outline-none focus:border-[var(--accent)] transition" />
    </div>
  );
}

function InstrumentRow({ instrument, onChange }: { instrument: InstrumentConfig; onChange: (inst: InstrumentConfig) => void }) {
  return (
    <div className="flex items-center gap-4 p-3 rounded-lg bg-[var(--background)]">
      <label className="flex items-center gap-2 cursor-pointer min-w-[140px]">
        <input type="checkbox" checked={instrument.enabled} onChange={(e) => onChange({ ...instrument, enabled: e.target.checked })} className="w-4 h-4 rounded" />
        <span className="text-sm font-medium">{instrument.label}</span>
      </label>
      <div className="flex items-center gap-3 text-xs">
        <label className="flex items-center gap-1">
          USDT:
          <input type="number" step="1" min="5" value={instrument.volume} onChange={(e) => onChange({ ...instrument, volume: parseFloat(e.target.value) || 20 })}
            className="w-16 px-2 py-1 rounded bg-[var(--card)] border border-[var(--card-border)] text-center" />
        </label>
        <label className="flex items-center gap-1">
          SL%:
          <input type="number" step="0.1" value={instrument.slPercent} onChange={(e) => onChange({ ...instrument, slPercent: parseFloat(e.target.value) || 0.5 })}
            className="w-16 px-2 py-1 rounded bg-[var(--card)] border border-[var(--card-border)] text-center" />
        </label>
        <label className="flex items-center gap-1">
          TP%:
          <input type="number" step="0.1" value={instrument.tpPercent} onChange={(e) => onChange({ ...instrument, tpPercent: parseFloat(e.target.value) || 0.3 })}
            className="w-16 px-2 py-1 rounded bg-[var(--card)] border border-[var(--card-border)] text-center" />
        </label>
      </div>
    </div>
  );
}
