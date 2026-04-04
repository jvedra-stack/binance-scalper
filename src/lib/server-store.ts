// ============================================================
// Server-side persistence – JSON soubory + env vars
// Používá se POUZE v API routes a server-side kódu
// ============================================================

import type { BotConfig, Trade } from "@/types";
import { DEFAULT_CONFIG } from "@/types";
import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const TRADES_FILE = path.join(DATA_DIR, "trades.json");

function ensureDataDir(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch { /* ok */ }
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    const data = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(data) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath: string, data: unknown): void {
  try {
    ensureDataDir();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch { /* ok */ }
}

function getEnvCredentials(): Partial<BotConfig> {
  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;
  const testnet = process.env.BINANCE_TESTNET === "true";

  if (apiKey && apiSecret) {
    return { credentials: { apiKey, apiSecret, testnet } };
  }
  return {};
}

export function loadServerConfig(): BotConfig {
  const fileConfig = readJsonFile<Partial<BotConfig>>(CONFIG_FILE, {});
  const envConfig = getEnvCredentials();
  return { ...DEFAULT_CONFIG, ...fileConfig, ...envConfig };
}

export function saveServerConfig(config: BotConfig): void {
  writeJsonFile(CONFIG_FILE, config);
}

export function loadServerTrades(): Trade[] {
  return readJsonFile<Trade[]>(TRADES_FILE, []);
}

export function saveServerTrades(trades: Trade[]): void {
  writeJsonFile(TRADES_FILE, trades);
}

export function addServerTrade(trade: Trade): void {
  const trades = loadServerTrades();
  trades.push(trade);
  saveServerTrades(trades);
}

export function getTodayTrades(): Trade[] {
  const trades = loadServerTrades();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  return trades.filter((t) => t.openTime >= todayStart.getTime());
}

export function getTodayPnL(): number {
  return getTodayTrades()
    .filter((t) => t.status === "closed" && t.profit !== undefined)
    .reduce((sum, t) => sum + (t.profit || 0), 0);
}

// Generické key-value storage pro ML a další moduly
export function loadServerData<T>(key: string): T | null {
  const filePath = path.join(DATA_DIR, `${key}.json`);
  try {
    const data = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

export function saveServerData(key: string, data: unknown): void {
  ensureDataDir();
  const filePath = path.join(DATA_DIR, `${key}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch { /* ok */ }
}
