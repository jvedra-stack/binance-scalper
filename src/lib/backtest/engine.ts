// ============================================================
// Backtest Engine – reusable backtesting logika
// Extrahováno z auto-setup, rozšířeno o detailní metriky
// ============================================================

import type { StrategyConfig, BybitKline } from "@/types";
import { DEFAULT_STRATEGY } from "@/types";
import { generateSignal } from "@/lib/strategy/scalping";

export interface BacktestTrade {
  entryTime: number;
  exitTime: number;
  direction: "BUY" | "SELL";
  entryPrice: number;
  exitPrice: number;
  profit: number;
  profitPercent: number;
  reason: string;
}

export interface BacktestResult {
  symbol: string;
  interval: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfit: number;
  avgProfit: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  profitFactor: number;
  sharpeRatio: number;
  equityCurve: { time: number; equity: number }[];
  trades: BacktestTrade[];
  config: StrategyConfig;
}

export interface BacktestParams {
  symbol: string;
  interval: string;
  klines: BybitKline[];
  config?: StrategyConfig;
  initialCapital?: number;
  positionSize?: number; // % kapitálu na trade
  slPercent?: number;
  tpPercent?: number;
}

export function runBacktest(params: BacktestParams): BacktestResult {
  const {
    symbol,
    interval,
    klines,
    config = DEFAULT_STRATEGY,
    initialCapital = 1000,
    positionSize = 5, // 5% kapitálu
    slPercent = 0.5,
    tpPercent = 0.35,
  } = params;

  const candles = klines.map((k) => ({
    close: k.close,
    ctm: k.start,
    ctmString: "",
    high: k.high,
    low: k.low,
    open: k.open,
    vol: k.volume,
  }));

  const trades: BacktestTrade[] = [];
  const equityCurve: { time: number; equity: number }[] = [];
  let equity = initialCapital;
  let maxEquity = initialCapital;
  let maxDrawdown = 0;
  let position: { direction: "BUY" | "SELL"; price: number; time: number; sl: number; tp: number } | null = null;

  const windowSize = Math.max(config.emaSlowPeriod, config.bbPeriod, config.atrPeriod) + 10;

  for (let i = windowSize; i < candles.length; i++) {
    const window = candles.slice(Math.max(0, i - windowSize), i + 1);
    const price = candles[i].close;
    const high = candles[i].high;
    const low = candles[i].low;
    const time = candles[i].ctm;

    if (position) {
      // Check SL/TP
      let exitPrice = 0;
      let reason = "";

      if (position.direction === "BUY") {
        if (low <= position.sl) {
          exitPrice = position.sl;
          reason = "Stop Loss";
        } else if (high >= position.tp) {
          exitPrice = position.tp;
          reason = "Take Profit";
        }
      } else {
        if (high >= position.sl) {
          exitPrice = position.sl;
          reason = "Stop Loss";
        } else if (low <= position.tp) {
          exitPrice = position.tp;
          reason = "Take Profit";
        }
      }

      if (exitPrice > 0) {
        const pnl = position.direction === "BUY"
          ? exitPrice - position.price
          : position.price - exitPrice;
        const pnlPercent = (pnl / position.price) * 100;
        const tradeSize = equity * (positionSize / 100);
        const profitUSDT = tradeSize * (pnlPercent / 100);

        equity += profitUSDT;
        maxEquity = Math.max(maxEquity, equity);
        maxDrawdown = Math.max(maxDrawdown, maxEquity - equity);

        trades.push({
          entryTime: position.time,
          exitTime: time,
          direction: position.direction,
          entryPrice: position.price,
          exitPrice,
          profit: profitUSDT,
          profitPercent: pnlPercent,
          reason,
        });

        position = null;
      }
    }

    // Record equity
    equityCurve.push({ time, equity });

    // Generate signal if no position
    if (!position && window.length >= windowSize) {
      const signal = generateSignal(symbol, window, price, config);
      if (signal.type !== "HOLD" && signal.confidence >= config.minConfidence) {
        const sl = signal.type === "BUY"
          ? price * (1 - slPercent / 100)
          : price * (1 + slPercent / 100);
        const tp = signal.type === "BUY"
          ? price * (1 + tpPercent / 100)
          : price * (1 - tpPercent / 100);

        position = { direction: signal.type, price, time, sl, tp };
      }
    }
  }

  // Close any remaining position at last price
  if (position) {
    const lastPrice = candles[candles.length - 1].close;
    const pnl = position.direction === "BUY"
      ? lastPrice - position.price
      : position.price - lastPrice;
    const pnlPercent = (pnl / position.price) * 100;
    const tradeSize = equity * (positionSize / 100);
    const profitUSDT = tradeSize * (pnlPercent / 100);
    equity += profitUSDT;

    trades.push({
      entryTime: position.time,
      exitTime: candles[candles.length - 1].ctm,
      direction: position.direction,
      entryPrice: position.price,
      exitPrice: lastPrice,
      profit: profitUSDT,
      profitPercent: pnlPercent,
      reason: "End of data",
    });
  }

  // Calculate metrics
  const wins = trades.filter((t) => t.profit > 0).length;
  const losses = trades.filter((t) => t.profit <= 0).length;
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
  const totalProfit = equity - initialCapital;
  const avgProfit = trades.length > 0 ? totalProfit / trades.length : 0;
  const maxDrawdownPercent = maxEquity > 0 ? (maxDrawdown / maxEquity) * 100 : 0;

  // Profit factor
  const grossProfit = trades.filter((t) => t.profit > 0).reduce((s, t) => s + t.profit, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.profit <= 0).reduce((s, t) => s + t.profit, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Sharpe ratio (simplified)
  const returns = trades.map((t) => t.profitPercent);
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdReturn = returns.length > 1
    ? Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (returns.length - 1))
    : 0;
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;

  return {
    symbol,
    interval,
    totalTrades: trades.length,
    wins,
    losses,
    winRate,
    totalProfit,
    avgProfit,
    maxDrawdown,
    maxDrawdownPercent,
    profitFactor,
    sharpeRatio,
    equityCurve,
    trades,
    config,
  };
}
