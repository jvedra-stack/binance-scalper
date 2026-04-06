import { NextRequest, NextResponse } from "next/server";
import { updateConfig, getEngineConfig } from "@/lib/bybit/connection";
import { loadServerConfig, saveServerConfig } from "@/lib/server-store";
import { DEFAULT_INSTRUMENTS, DEFAULT_STRATEGY, DEFAULT_RISK } from "@/types";

export const dynamic = "force-dynamic";

export async function GET() {
  // Vrať server config (source of truth) — ne in-memory který mohl být přepsán browserem
  const serverConfig = loadServerConfig();
  return NextResponse.json(serverConfig);
}

export async function POST(req: NextRequest) {
  const partial = await req.json();

  // Validace — browser nesmí přepsat instrumenty/strategy/risk
  // Povolíme jen credentials a active flag
  const safePartial: Record<string, unknown> = {};
  if (partial.credentials) safePartial.credentials = partial.credentials;
  if (partial.active !== undefined) safePartial.active = partial.active;
  // Instrumenty/strategy/risk se mění jen pokud přišly ze Settings stránky (ne z Start)
  if (partial.instruments) safePartial.instruments = partial.instruments;
  if (partial.strategy) safePartial.strategy = partial.strategy;
  if (partial.risk) safePartial.risk = partial.risk;

  const updated = updateConfig(safePartial);
  saveServerConfig(updated);
  return NextResponse.json(updated);
}
