import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/bybit/connection";
import { BybitClient } from "@/lib/bybit/client";
import type { BybitKline, StrategyConfig } from "@/types";
import { DEFAULT_STRATEGY } from "@/types";
import { runBacktest, type BacktestResult } from "@/lib/backtest/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT",
  "DOGEUSDT", "AVAXUSDT", "SUIUSDT", "PEPEUSDT",
];

// POST /api/xtb/backtest-multi
// Spustí backtest na více symbolech naráz
export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    symbols = DEFAULT_SYMBOLS,
    interval = "5m",
    limit = 500,
    slPercent = 0.5,
    tpPercent = 0.35,
    config,
  } = body as {
    symbols?: string[];
    interval?: string;
    limit?: number;
    slPercent?: number;
    tpPercent?: number;
    config?: Partial<StrategyConfig>;
  };

  let client = getClient();
  let ownClient = false;
  if (!client) {
    const apiKey = process.env.BINANCE_API_KEY || "";
    const apiSecret = process.env.BINANCE_API_SECRET || "";
    const testnet = process.env.BINANCE_TESTNET === "true";
    if (!apiKey || !apiSecret) {
      return NextResponse.json({ ok: false, error: "Chybí credentials" }, { status: 400 });
    }
    client = new BybitClient({ apiKey, apiSecret, testnet });
    ownClient = true;
  }

  const strategyConfig: StrategyConfig = { ...DEFAULT_STRATEGY, ...config };
  const results: BacktestResult[] = [];

  try {
    for (const symbol of symbols) {
      try {
        const result = await client.getKlines(symbol, interval, Math.min(limit, 1500));
        const klines: BybitKline[] = (result.list || []).map((k: string[]) => ({
          start: parseInt(k[0]), end: parseInt(k[0]) + 60000,
          open: parseFloat(k[1]), high: parseFloat(k[2]),
          low: parseFloat(k[3]), close: parseFloat(k[4]),
          volume: parseFloat(k[5]), turnover: parseFloat(k[6]),
        })).reverse();

        if (klines.length < 50) continue;

        const bt = runBacktest({ symbol, interval, klines, config: strategyConfig, slPercent, tpPercent });
        results.push(bt);
      } catch { /* skip symbol */ }
    }

    if (ownClient) (client as BybitClient).disconnect();

    // Souhrn
    const totalTrades = results.reduce((s, r) => s + r.totalTrades, 0);
    const totalProfit = results.reduce((s, r) => s + r.totalProfit, 0);
    const totalWins = results.reduce((s, r) => s + r.wins, 0);
    const avgWinRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;

    return NextResponse.json({
      ok: true,
      results: results.sort((a, b) => b.totalProfit - a.totalProfit),
      summary: { totalTrades, totalProfit, avgWinRate, symbols: results.length },
    });
  } catch (err) {
    if (ownClient) (client as BybitClient).disconnect();
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Chyba" }, { status: 500 });
  }
}
