import { NextRequest, NextResponse } from "next/server";
import { BybitClient } from "@/lib/bybit/client";
import type { BybitCredentials, InstrumentConfig, StrategyConfig, RiskConfig, BybitKline } from "@/types";
import { generateSignal } from "@/lib/strategy/scalping";
import { DEFAULT_STRATEGY } from "@/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Top krypto páry pro scalping
const CANDIDATES = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT",
  "AVAXUSDT", "ADAUSDT", "MATICUSDT", "LINKUSDT", "DOTUSDT",
  "NEARUSDT", "ARBUSDT", "OPUSDT", "SUIUSDT", "PEPEUSDT",
];

interface BacktestResult {
  symbol: string;
  label: string;
  totalTrades: number;
  winRate: number;
  avgProfit: number;
  totalProfit: number;
  maxDrawdown: number;
  score: number;
  bestConfig: StrategyConfig;
}

export async function POST(req: NextRequest) {
  const { credentials } = (await req.json()) as { credentials: BybitCredentials };

  if (!credentials?.apiKey || !credentials?.apiSecret) {
    return NextResponse.json({ ok: false, error: "Chybí API klíč nebo secret" }, { status: 400 });
  }

  const client = new BybitClient(credentials);

  try {
    // Test auth + balance
    const balanceResult = await client.getBalance();
    const totalEquity = parseFloat(balanceResult.list?.[0]?.totalEquity || "0");

    if (totalEquity <= 0) {
      return NextResponse.json({ ok: false, error: "Účet nemá žádný zůstatek" }, { status: 400 });
    }

    // Stáhni tickers pro filtrování
    const tickersResult = await client.getTickers();
    const tickerMap = new Map(tickersResult.list.map((t) => [t.symbol, t]));

    // Filtruj kandidáty co existují a mají dostatečný volume
    const available = CANDIDATES.filter((s) => {
      const t = tickerMap.get(s);
      return t && parseFloat(t.volume24h) > 1000000;
    });

    // Backtest na každém
    const backtestResults: BacktestResult[] = [];

    for (const symbol of available) {
      try {
        const klinesResult = await client.getKlines(symbol, "1", 200);
        const klines: BybitKline[] = (klinesResult.list || []).map((k: string[]) => ({
          start: parseInt(k[0]), end: parseInt(k[0]) + 60000,
          open: parseFloat(k[1]), high: parseFloat(k[2]),
          low: parseFloat(k[3]), close: parseFloat(k[4]),
          volume: parseFloat(k[5]), turnover: parseFloat(k[6]),
        })).reverse();

        if (klines.length < 100) continue;

        const result = runBacktest(symbol, klines, tickerMap.get(symbol)!);
        if (result) backtestResults.push(result);
      } catch { /* skip */ }
    }

    backtestResults.sort((a, b) => b.score - a.score);
    const topSymbols = backtestResults.slice(0, 3);

    // Risk config podle zůstatku
    const risk = calculateRisk(totalEquity);

    // Instrumenty — pokud backtest nic nenašel, použij defaultní
    let instruments: InstrumentConfig[];
    if (topSymbols.length > 0) {
      instruments = topSymbols.map((r) => ({
        symbol: r.symbol,
        label: r.label,
        enabled: true,
        volume: calculateVolume(r.symbol, totalEquity),
        slPercent: 0.5,
        tpPercent: 0.3,
      }));
    } else {
      // Fallback — top krypto páry co jsou na každém Binance
      const fallbackPairs = [
        { symbol: "BTCUSDT", label: "Bitcoin" },
        { symbol: "ETHUSDT", label: "Ethereum" },
        { symbol: "SOLUSDT", label: "Solana" },
      ];
      // Ověř že existují
      const validPairs = fallbackPairs.filter((p) => tickerMap.has(p.symbol));
      instruments = (validPairs.length > 0 ? validPairs : fallbackPairs).map((p) => ({
        symbol: p.symbol,
        label: p.label,
        enabled: true,
        volume: calculateVolume(p.symbol, totalEquity),
        slPercent: 0.5,
        tpPercent: 0.3,
      }));
    }

    const strategy = topSymbols.length > 0 ? topSymbols[0].bestConfig : DEFAULT_STRATEGY;

    client.disconnect();

    return NextResponse.json({
      ok: true,
      balance: totalEquity,
      instruments,
      strategy,
      risk,
      backtestResults,
    });
  } catch (err) {
    client.disconnect();
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Neznámá chyba" },
      { status: 500 }
    );
  }
}

function runBacktest(symbol: string, klines: BybitKline[], ticker: Record<string, string>): BacktestResult | null {
  const configs: StrategyConfig[] = [
    { ...DEFAULT_STRATEGY, emaFastPeriod: 5, emaSlowPeriod: 13, minConfidence: 0.5 },
    { ...DEFAULT_STRATEGY },
    { ...DEFAULT_STRATEGY, emaFastPeriod: 8, emaSlowPeriod: 17, rsiPeriod: 10, minConfidence: 0.55 },
    { ...DEFAULT_STRATEGY, emaFastPeriod: 12, emaSlowPeriod: 26, rsiOverbought: 65, rsiOversold: 35 },
  ];

  let best: BacktestResult | null = null;
  const candles = klines.map((k) => ({ close: k.close, ctm: k.start, ctmString: "", high: k.high, low: k.low, open: k.open, vol: k.volume }));

  for (const config of configs) {
    const result = simulate(symbol, candles, config, ticker);
    if (!best || result.score > best.score) best = result;
  }

  return best;
}

function simulate(symbol: string, candles: Array<{ close: number; ctm: number; ctmString: string; high: number; low: number; open: number; vol: number }>, config: StrategyConfig, ticker: Record<string, string>): BacktestResult {
  const trades: { profit: number }[] = [];
  let equity = 0, maxEquity = 0, maxDrawdown = 0;
  let position: { direction: "BUY" | "SELL"; price: number } | null = null;

  const windowSize = Math.max(config.emaSlowPeriod, config.bbPeriod, config.atrPeriod) + 10;

  for (let i = windowSize; i < candles.length; i++) {
    const window = candles.slice(i - windowSize, i + 1);
    const price = candles[i].close;

    if (position) {
      const pnl = position.direction === "BUY" ? price - position.price : position.price - price;
      const pnlPct = (pnl / position.price) * 100;
      if (pnlPct <= -0.3 || pnlPct >= 0.2) {
        trades.push({ profit: pnl });
        equity += pnl;
        maxEquity = Math.max(maxEquity, equity);
        maxDrawdown = Math.max(maxDrawdown, maxEquity - equity);
        position = null;
      }
      continue;
    }

    const signal = generateSignal(symbol, window, price, config);
    if (signal.type !== "HOLD") {
      position = { direction: signal.type, price };
    }
  }

  if (position) {
    const lastPrice = candles[candles.length - 1].close;
    const pnl = position.direction === "BUY" ? lastPrice - position.price : position.price - lastPrice;
    trades.push({ profit: pnl });
    equity += pnl;
  }

  const wins = trades.filter((t) => t.profit > 0).length;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
  const avgProfit = trades.length > 0 ? trades.reduce((s, t) => s + t.profit, 0) / trades.length : 0;
  const tradeFreq = Math.min(trades.length / 10, 1);
  const winScore = winRate / 100;
  const profitScore = equity > 0 ? Math.min(equity / 10, 1) : Math.max(equity / 10, -1);
  const ddPenalty = maxDrawdown > 0 ? Math.min(maxDrawdown / 50, 0.5) : 0;
  const score = (winScore * 0.4 + profitScore * 0.3 + tradeFreq * 0.3) - ddPenalty;

  return {
    symbol,
    label: symbol.replace("USDT", ""),
    totalTrades: trades.length,
    winRate, avgProfit, totalProfit: equity, maxDrawdown, score,
    bestConfig: config,
  };
}

function calculateRisk(balance: number): RiskConfig {
  return {
    maxOpenPositions: balance > 5000 ? 3 : 2,
    maxDailyLoss: Math.max(Math.round(balance * 0.02), 10),
    maxDailyTrades: 20,
    trailingStop: true,
    trailingStopPercent: 0.2,
  };
}

function calculateVolume(symbol: string, balance: number): number {
  // Max 5% účtu na trade
  const tradeSize = balance * 0.05;
  // V USDT pro linear futures
  return Math.max(5, Math.round(tradeSize));
}
