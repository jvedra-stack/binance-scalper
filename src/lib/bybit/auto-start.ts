// ============================================================
// Auto-start – spustí bota automaticky pokud jsou env vars
// Volá se při startu serveru (z instrumentation.ts)
// ============================================================

import { startEngine, getEngineState } from "./connection";
import { loadServerConfig, saveServerConfig } from "@/lib/server-store";
import type { BotConfig } from "@/types";
import { DEFAULT_INSTRUMENTS, DEFAULT_STRATEGY, DEFAULT_RISK } from "@/types";

export async function autoStartBot(): Promise<void> {
  const state = getEngineState();
  if (state.status === "running") return; // už běží

  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;

  if (!apiKey || !apiSecret) {
    console.log("[AUTO-START] Žádné env vars BINANCE_API_KEY/SECRET — bot se nespustí automaticky");
    return;
  }

  console.log("[AUTO-START] Nalezeny Binance credentials, startuji bota...");

  // Načti uloženou konfiguraci — DEFAULT_CONFIG se použije jako základ
  const savedConfig = loadServerConfig();
  const config: BotConfig = {
    ...savedConfig,
    credentials: {
      apiKey,
      apiSecret,
      testnet: process.env.BINANCE_TESTNET === "true",
    },
    active: true, // automaticky aktivní
  };

  // Ulož config na disk — zajistí že data/config.json existuje
  saveServerConfig(config);
  console.log(`[AUTO-START] Config: ${config.instruments.filter(i => i.enabled).map(i => i.symbol).join(", ")} | minConf: ${config.strategy.minConfidence} | volume: ${config.instruments[0]?.volume}`);

  try {
    await startEngine(config);
    console.log("[AUTO-START] Bot úspěšně spuštěn a aktivní");
  } catch (err) {
    console.error("[AUTO-START] Chyba při startu:", err instanceof Error ? err.message : err);
  }
}
