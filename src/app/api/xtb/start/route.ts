import { NextRequest, NextResponse } from "next/server";
import { startEngine, updateConfig } from "@/lib/bybit/connection";
import { saveServerConfig } from "@/lib/server-store";
import { DEFAULT_INSTRUMENTS, DEFAULT_STRATEGY, DEFAULT_RISK } from "@/types";
import type { BotConfig } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const clientConfig = await req.json();

    // VŽDY kódové defaulty — browser NEMŮŽE přepsat instrumenty/strategy/risk
    const config: BotConfig = {
      credentials: clientConfig.credentials || { apiKey: "", apiSecret: "", testnet: false },
      instruments: DEFAULT_INSTRUMENTS,
      strategy: DEFAULT_STRATEGY,
      risk: DEFAULT_RISK,
      active: true,
    };

    updateConfig(config);
    saveServerConfig(config);
    await startEngine(config);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Neznámá chyba" },
      { status: 500 }
    );
  }
}
