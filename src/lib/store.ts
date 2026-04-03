// ============================================================
// Client-side persistence (localStorage) – browser only
// ============================================================

import type { BotConfig, Trade } from "@/types";
import { DEFAULT_CONFIG } from "@/types";

const CONFIG_KEY = "binance-scalper-config";
const TRADES_KEY = "binance-scalper-trades";

export function loadConfig(): BotConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const data = localStorage.getItem(CONFIG_KEY);
    if (!data) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: BotConfig): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export function loadTrades(): Trade[] {
  if (typeof window === "undefined") return [];
  try {
    const data = localStorage.getItem(TRADES_KEY);
    if (!data) return [];
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export function saveTrades(trades: Trade[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TRADES_KEY, JSON.stringify(trades));
}
