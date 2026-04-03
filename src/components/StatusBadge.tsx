"use client";

import type { EngineStatus } from "@/types";

const statusMap: Record<EngineStatus, { label: string; color: string }> = {
  stopped: { label: "Zastaveno", color: "var(--muted)" },
  connecting: { label: "Připojování...", color: "var(--yellow)" },
  running: { label: "Běží", color: "var(--green)" },
  error: { label: "Chyba", color: "var(--red)" },
  killed: { label: "Kill switch", color: "var(--red)" },
};

export default function StatusBadge({ status }: { status: EngineStatus }) {
  const info = statusMap[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold"
      style={{ background: `${info.color}20`, color: info.color }}
    >
      <span
        className="w-2 h-2 rounded-full animate-pulse"
        style={{ background: info.color }}
      />
      {info.label}
    </span>
  );
}
