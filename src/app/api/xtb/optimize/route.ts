import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/bybit/connection";
import { BybitClient } from "@/lib/bybit/client";
import type { BybitKline, StrategyConfig } from "@/types";
import { DEFAULT_STRATEGY } from "@/types";
import { runBacktest, type BacktestResult } from "@/lib/backtest/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/xtb/optimize
export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    symbol = "BTCUSDT",
    interval = "5m",
    limit = 300,
  } = body as { symbol?: string; interval?: string; limit?: number };

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

  try {
    const result = await client.getKlines(symbol, interval, Math.min(limit, 500));
    const klines: BybitKline[] = (result.list || []).map((k: string[]) => ({
      start: parseInt(k[0]), end: parseInt(k[0]) + 60000,
      open: parseFloat(k[1]), high: parseFloat(k[2]),
      low: parseFloat(k[3]), close: parseFloat(k[4]),
      volume: parseFloat(k[5]), turnover: parseFloat(k[6]),
    })).reverse();

    if (klines.length < 50) {
      return NextResponse.json({ ok: false, error: "Nedostatek dat" }, { status: 400 });
    }

    // Grid search – menší grid pro rychlost
    const slValues = [0.3, 0.5, 0.8];
    const tpValues = [0.2, 0.35, 0.5];
    const confValues = [0.4, 0.5];

    const results: Array<BacktestResult & { params: { sl: number; tp: number; conf: number } }> = [];

    for (const sl of slValues) {
      for (const tp of tpValues) {
        for (const conf of confValues) {
          const config: StrategyConfig = { ...DEFAULT_STRATEGY, minConfidence: conf };
          const bt = runBacktest({ symbol, interval, klines, config, slPercent: sl, tpPercent: tp });
          results.push({ ...bt, params: { sl, tp, conf } });
        }
      }
    }

    results.sort((a, b) => {
      const scoreA = (a.profitFactor === Infinity ? 10 : a.profitFactor) * Math.sign(a.totalProfit) * Math.sqrt(Math.abs(a.totalProfit) + 1);
      const scoreB = (b.profitFactor === Infinity ? 10 : b.profitFactor) * Math.sign(b.totalProfit) * Math.sqrt(Math.abs(b.totalProfit) + 1);
      return scoreB - scoreA;
    });

    if (ownClient) (client as BybitClient).disconnect();

    return NextResponse.json({
      ok: true,
      results: results.slice(0, 15),
      total: results.length,
    });
  } catch (err) {
    if (ownClient) (client as BybitClient).disconnect();
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Chyba" }, { status: 500 });
  }
}
