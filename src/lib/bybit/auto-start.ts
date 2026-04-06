// ============================================================
// Auto-start – spustí bota automaticky pokud jsou env vars
// Volá se při startu serveru (z instrumentation.ts)
// ============================================================

import { BybitClient } from "./client";
import { startEngine, getEngineState } from "./connection";
import { saveServerConfig } from "@/lib/server-store";
import type { BotConfig, InstrumentConfig } from "@/types";
import { DEFAULT_INSTRUMENTS, DEFAULT_STRATEGY, DEFAULT_RISK } from "@/types";

const LEVERAGE = 50;
const BALANCE_PERCENT = 0.05; // 5% účtu na pozici
const MIN_VOLUME = 100; // minimum USDT na pozici
const MAX_VOLUME = 5000; // maximum USDT na pozici

export async function autoStartBot(): Promise<void> {
  const state = getEngineState();
  if (state.status === "running") return;

  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;

  if (!apiKey || !apiSecret) {
    console.log("[AUTO-START] Žádné env vars — bot se nespustí");
    return;
  }

  const credentials = {
    apiKey,
    apiSecret,
    testnet: process.env.BINANCE_TESTNET === "true",
  };

  // 1. Stáhni balance
  let balance = 0;
  try {
    const client = new BybitClient(credentials);
    const bal = await client.getBalance();
    balance = parseFloat(bal.list?.[0]?.totalEquity || "0");
    console.log(`[AUTO-START] Balance: ${balance.toFixed(2)} USDT`);
  } catch (err) {
    console.error("[AUTO-START] Nelze stáhnout balance:", err instanceof Error ? err.message : err);
  }

  // 2. Spočítej optimální volume podle balance
  const optimalVolume = balance > 0
    ? Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, Math.round(balance * BALANCE_PERCENT * LEVERAGE)))
    : DEFAULT_INSTRUMENTS[0].volume; // fallback na default

  // 3. Nastav instrumenty s dynamickým volume
  const instruments: InstrumentConfig[] = DEFAULT_INSTRUMENTS.map((inst) => ({
    ...inst,
    volume: inst.enabled ? optimalVolume : inst.volume,
  }));

  // 4. Spočítej max daily loss podle balance (3% účtu)
  const maxDailyLoss = balance > 0 ? Math.max(20, Math.round(balance * 0.03)) : DEFAULT_RISK.maxDailyLoss;

  const config: BotConfig = {
    credentials,
    instruments,
    strategy: DEFAULT_STRATEGY,
    risk: { ...DEFAULT_RISK, maxDailyLoss },
    active: true,
  };

  saveServerConfig(config);
  console.log(`[AUTO-START] Coiny: ${instruments.filter(i => i.enabled).map(i => `${i.symbol}(${i.volume})`).join(", ")} | balance: ${balance.toFixed(0)} | maxLoss: ${maxDailyLoss} | minConf: ${config.strategy.minConfidence}`);

  try {
    await startEngine(config);
    console.log("[AUTO-START] Bot spuštěn — kompletně automaticky");
  } catch (err) {
    console.error("[AUTO-START] Chyba:", err instanceof Error ? err.message : err);
  }
}
