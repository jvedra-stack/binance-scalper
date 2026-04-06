// ============================================================
// Auto-start – spustí bota automaticky pokud jsou env vars
// Volá se při startu serveru (z instrumentation.ts)
// ============================================================

import { startEngine, getEngineState } from "./connection";
import { saveServerConfig } from "@/lib/server-store";
import type { BotConfig } from "@/types";
import { DEFAULT_INSTRUMENTS, DEFAULT_STRATEGY, DEFAULT_RISK } from "@/types";

export async function autoStartBot(): Promise<void> {
  const state = getEngineState();
  if (state.status === "running") return;

  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;

  if (!apiKey || !apiSecret) {
    console.log("[AUTO-START] Žádné env vars — bot se nespustí");
    return;
  }

  // VŽDY použij kódové defaulty — žádný uložený config, žádný localStorage
  const config: BotConfig = {
    credentials: {
      apiKey,
      apiSecret,
      testnet: process.env.BINANCE_TESTNET === "true",
    },
    instruments: DEFAULT_INSTRUMENTS,
    strategy: DEFAULT_STRATEGY,
    risk: DEFAULT_RISK,
    active: true,
  };

  // Přepiš uložený config na disku kódovými defaulty
  saveServerConfig(config);
  console.log(`[AUTO-START] FORCED DEFAULTS: ${config.instruments.filter(i => i.enabled).map(i => i.symbol).join(", ")} | vol: ${config.instruments[0]?.volume} | SL: ${config.instruments[0]?.slPercent}% | TP: ${config.instruments[0]?.tpPercent}% | minConf: ${config.strategy.minConfidence} | maxLoss: ${config.risk.maxDailyLoss} | maxPos: ${config.risk.maxOpenPositions}`);

  try {
    await startEngine(config);
    console.log("[AUTO-START] Bot spuštěn");
  } catch (err) {
    console.error("[AUTO-START] Chyba:", err instanceof Error ? err.message : err);
  }
}
