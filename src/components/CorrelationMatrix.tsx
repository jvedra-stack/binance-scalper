"use client";

import { useState, useEffect } from "react";

interface CorrelationData {
  symbols: string[];
  matrix: number[][];
}

function getCorrelationColor(value: number): string {
  if (value >= 0.7) return "rgba(239,68,68,0.8)";   // silná pozitivní = červená (riziko)
  if (value >= 0.4) return "rgba(239,68,68,0.4)";
  if (value >= 0.1) return "rgba(239,68,68,0.15)";
  if (value > -0.1) return "rgba(113,113,122,0.15)"; // neutrální
  if (value > -0.4) return "rgba(34,197,94,0.15)";
  if (value > -0.7) return "rgba(34,197,94,0.4)";
  return "rgba(34,197,94,0.8)";                       // silná negativní = zelená
}

function getTextColor(value: number): string {
  if (Math.abs(value) >= 0.7) return "#fff";
  return "var(--foreground)";
}

export default function CorrelationMatrix() {
  const [data, setData] = useState<CorrelationData | null>(null);

  useEffect(() => {
    async function fetch_() {
      try {
        const res = await fetch("/api/xtb/correlation");
        if (res.ok) {
          const json = await res.json();
          if (json.ok) setData(json.correlation);
        }
      } catch { /* ok */ }
    }
    fetch_();
    const interval = setInterval(fetch_, 15000);
    return () => clearInterval(interval);
  }, []);

  if (!data || data.symbols.length < 2) {
    return (
      <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] p-4">
        <h2 className="font-semibold mb-2">Korelacni matice</h2>
        <p className="text-sm text-[var(--muted)]">Bot musi bezet pro vypocet korelaci</p>
      </div>
    );
  }

  const labels = data.symbols.map((s) => s.replace("USDT", ""));

  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card)] overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--card-border)] flex items-center justify-between">
        <h2 className="font-semibold">Korelacni matice</h2>
        <div className="flex items-center gap-3 text-xs text-[var(--muted)]">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded" style={{ background: "rgba(34,197,94,0.6)" }} />
            Negativni
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded" style={{ background: "rgba(113,113,122,0.15)" }} />
            Neutralni
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded" style={{ background: "rgba(239,68,68,0.6)" }} />
            Pozitivni
          </span>
        </div>
      </div>
      <div className="p-4 overflow-x-auto">
        <table className="text-xs">
          <thead>
            <tr>
              <th className="px-2 py-1" />
              {labels.map((l) => (
                <th key={l} className="px-2 py-1 text-[var(--muted)] font-medium">{l}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.matrix.map((row, i) => (
              <tr key={labels[i]}>
                <td className="px-2 py-1 text-[var(--muted)] font-medium text-right">{labels[i]}</td>
                {row.map((val, j) => (
                  <td key={j} className="px-1 py-1">
                    <div
                      className="w-12 h-8 rounded flex items-center justify-center font-mono font-semibold text-xs"
                      style={{
                        background: i === j ? "rgba(59,130,246,0.2)" : getCorrelationColor(val),
                        color: i === j ? "var(--accent)" : getTextColor(val),
                      }}
                      title={`${data.symbols[i]} / ${data.symbols[j]}: ${(val * 100).toFixed(0)}%`}
                    >
                      {i === j ? "1.0" : val.toFixed(2)}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
