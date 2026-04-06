import { NextRequest, NextResponse } from "next/server";
import { startEngine, updateConfig } from "@/lib/bybit/connection";
import { loadServerConfig, saveServerConfig } from "@/lib/server-store";
import { DEFAULT_INSTRUMENTS, DEFAULT_STRATEGY, DEFAULT_RISK } from "@/types";
import type { BotConfig } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const clientConfig: BotConfig = await req.json();

    // Server-side defaulty mají přednost — browser nesmí přepsat instrumenty/risk/strategy
    const serverConfig = loadServerConfig();
    const config: BotConfig = {
      // Credentials z klienta (nebo env vars)
      credentials: clientConfig.credentials,
      // Instrumenty, strategie, risk VŽDY ze serveru (ne z browseru)
      instruments: serverConfig.instruments?.length > 0 ? serverConfig.instruments : DEFAULT_INSTRUMENTS,
      strategy: serverConfig.strategy || DEFAULT_STRATEGY,
      risk: serverConfig.risk || DEFAULT_RISK,
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
