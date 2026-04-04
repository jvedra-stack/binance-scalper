import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/bybit/connection";
import { BybitClient } from "@/lib/bybit/client";
import type { BybitKline, StrategyConfig } from "@/types";
import { DEFAULT_STRATEGY } from "@/types";
import { runBacktest } from "@/lib/backtest/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/xtb/backtest
// Body: { symbol, interval, limit?, config?, slPercent?, tpPercent? }
export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    symbol = "BTCUSDT",
    interval = "1m",
    limit = 1000,
    config,
    slPercent = 0.5,
    tpPercent = 0.35,
  } = body as {
    symbol?: string;
    interval?: string;
    limit?: number;
    config?: Partial<StrategyConfig>;
    slPercent?: number;
    tpPercent?: number;
  };

  // Použij existujícího klienta nebo vytvoř nového z env vars
  let client = getClient();
  let ownClient = false;

  if (!client) {
    const apiKey = process.env.BINANCE_API_KEY || "";
    const apiSecret = process.env.BINANCE_API_SECRET || "";
    const testnet = process.env.BINANCE_TESTNET === "true";
    if (!apiKey || !apiSecret) {
      return NextResponse.json({ ok: false, error: "Bot neběží a chybí env credentials" }, { status: 400 });
    }
    client = new BybitClient({ apiKey, apiSecret, testnet });
    ownClient = true;
  }

  try {
    const result = await client.getKlines(symbol, interval, Math.min(limit, 1500));
    const klines: BybitKline[] = (result.list || []).map((k: string[]) => ({
      start: parseInt(k[0]),
      end: parseInt(k[0]) + 60000,
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      turnover: parseFloat(k[6]),
    })).reverse();

    if (klines.length < 50) {
      return NextResponse.json({ ok: false, error: "Nedostatek dat pro backtest" }, { status: 400 });
    }

    const strategyConfig: StrategyConfig = { ...DEFAULT_STRATEGY, ...config };

    const backtestResult = runBacktest({
      symbol,
      interval,
      klines,
      config: strategyConfig,
      slPercent,
      tpPercent,
    });

    if (ownClient) (client as BybitClient).disconnect();

    return NextResponse.json({ ok: true, result: backtestResult });
  } catch (err) {
    if (ownClient) (client as BybitClient).disconnect();
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Chyba" },
      { status: 500 }
    );
  }
}
