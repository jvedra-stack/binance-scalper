// ============================================================
// Server-side singleton pro Binance Futures spojení
// S garantovaným SL/TP, trade persistencí a dynamickým sizingem
// ============================================================

import { BybitClient } from "./client";
import { generateSignal, dynamicPositionSize } from "@/lib/strategy/scalping";
import { checkRisk, calculateSLTP } from "@/lib/risk/manager";
import { loadServerTrades, saveServerTrades, addServerTrade } from "@/lib/server-store";
import type {
  BybitCredentials,
  BybitKline,
  BybitTicker,
  EngineState,
  Trade,
  BotConfig,
  InstrumentConfig,
} from "@/types";
import { DEFAULT_STRATEGY, DEFAULT_RISK, DEFAULT_INSTRUMENTS } from "@/types";

function klineToCandle(k: BybitKline) {
  return { close: k.close, ctm: k.start, ctmString: "", high: k.high, low: k.low, open: k.open, vol: k.volume };
}

const globalState = globalThis as unknown as {
  __bybit_client?: BybitClient;
  __bybit_state?: EngineState;
  __bybit_config?: BotConfig;
  __bybit_candles?: Map<string, BybitKline[]>;
  __bybit_check_interval?: ReturnType<typeof setInterval>;
  __bybit_listeners?: Array<(event: string, data: unknown) => void>;
};

function getState(): EngineState {
  if (!globalState.__bybit_state) {
    globalState.__bybit_state = {
      status: "stopped", openPositions: [], todayTrades: [], todayPnL: 0, signals: [],
    };
  }
  return globalState.__bybit_state;
}

function setState(partial: Partial<EngineState>): void {
  globalState.__bybit_state = { ...getState(), ...partial };
  const listeners = globalState.__bybit_listeners || [];
  listeners.forEach((l) => l("state", globalState.__bybit_state));
}

function getConfig(): BotConfig {
  if (!globalState.__bybit_config) {
    const apiKey = process.env.BINANCE_API_KEY || "";
    const apiSecret = process.env.BINANCE_API_SECRET || "";
    const testnet = process.env.BINANCE_TESTNET === "true";
    globalState.__bybit_config = {
      credentials: { apiKey, apiSecret, testnet },
      instruments: DEFAULT_INSTRUMENTS,
      strategy: DEFAULT_STRATEGY,
      risk: DEFAULT_RISK,
      active: false,
    };
  }
  return globalState.__bybit_config;
}

function getCandleBuffers(): Map<string, BybitKline[]> {
  if (!globalState.__bybit_candles) globalState.__bybit_candles = new Map();
  return globalState.__bybit_candles;
}

// Trade historie — načítá se z JSON souboru na serveru
function getTrades(): Trade[] {
  return loadServerTrades();
}

function saveTrade(trade: Trade): void {
  addServerTrade(trade);
}

// --- Public API ---

export function addSSEListener(listener: (event: string, data: unknown) => void): () => void {
  if (!globalState.__bybit_listeners) globalState.__bybit_listeners = [];
  globalState.__bybit_listeners.push(listener);
  return () => {
    globalState.__bybit_listeners = (globalState.__bybit_listeners || []).filter((l) => l !== listener);
  };
}

export function getEngineState(): EngineState { return getState(); }
export function getEngineConfig(): BotConfig { return getConfig(); }
export function getAllTrades(): Trade[] { return getTrades(); }

export async function closeAllPositions(): Promise<void> {
  const client = globalState.__bybit_client;
  if (!client) return;
  for (const pos of getState().openPositions) {
    try {
      await client.closePosition(pos.symbol, pos.direction === "BUY" ? "Buy" : "Sell", pos.volume.toString());
      saveTrade({ ...pos, status: "closed", closeTime: Date.now(), profit: pos.profit || 0 });
      console.log(`[CLOSE] ${pos.symbol} ${pos.direction} P&L: ${pos.profit?.toFixed(2)}`);
    } catch (err) {
      console.error(`[CLOSE] Chyba: ${err instanceof Error ? err.message : err}`);
    }
  }
  setState({ openPositions: [] });
}

export function updateConfig(config: Partial<BotConfig>): BotConfig {
  globalState.__bybit_config = { ...getConfig(), ...config };
  return globalState.__bybit_config;
}

export async function startEngine(config: BotConfig): Promise<void> {
  if (globalState.__bybit_client?.isConnected) stopEngine();
  globalState.__bybit_config = config;
  setState({ status: "connecting", error: undefined });

  try {
    const client = new BybitClient(config.credentials);
    const balance = await client.getBalance();
    const totalEquity = parseFloat(balance.list?.[0]?.totalEquity || "0");

    await client.connectPublicWs();
    globalState.__bybit_client = client;

    client.setDisconnectHandler(() => {
      setState({ status: "error", error: "Odpojeno od Binance" });
      stopEngine();
    });

    const enabled = config.instruments.filter((i) => i.enabled);
    for (const inst of enabled) {
      await loadKlineHistory(client, inst.symbol);
      subscribeInstrument(client, inst);
    }

    // Sync pozic
    try {
      const positions = await client.getPositions();
      const openPositions: Trade[] = positions.list
        .filter((p) => parseFloat(p.size) > 0)
        .map((p) => ({
          id: `pos_${p.symbol}_${p.side}`,
          symbol: p.symbol,
          direction: p.side === "Buy" ? "BUY" as const : "SELL" as const,
          volume: parseFloat(p.size),
          openPrice: parseFloat(p.avgPrice),
          openTime: Date.now(),
          sl: parseFloat(p.stopLoss) || 0,
          tp: parseFloat(p.takeProfit) || 0,
          profit: parseFloat(p.unrealisedPnl),
          status: "open" as const,
          signal: {
            type: (p.side === "Buy" ? "BUY" : "SELL") as "BUY" | "SELL",
            symbol: p.symbol, price: parseFloat(p.avgPrice), timestamp: Date.now(),
            confidence: 0, reasons: ["Sync z Binance"],
            indicators: { emaFast: 0, emaSlow: 0, rsi: 50, bbUpper: 0, bbMiddle: 0, bbLower: 0, atr: 0, volume: 0, timestamp: Date.now() },
          },
        }));
      setState({ openPositions });
    } catch { /* ok */ }

    setState({ status: "running", connectedAt: Date.now(), error: undefined, balance: totalEquity });

    if (globalState.__bybit_check_interval) clearInterval(globalState.__bybit_check_interval);
    globalState.__bybit_check_interval = setInterval(() => periodicCheck(), 8000);

  } catch (err) {
    setState({ status: "error", error: err instanceof Error ? err.message : "Neznámá chyba" });
    throw err;
  }
}

export function stopEngine(): void {
  if (globalState.__bybit_check_interval) {
    clearInterval(globalState.__bybit_check_interval);
    globalState.__bybit_check_interval = undefined;
  }
  globalState.__bybit_client?.disconnect();
  globalState.__bybit_client = undefined;
  getCandleBuffers().clear();
  setState({ status: "stopped" });
}

export function getClient(): BybitClient | undefined {
  return globalState.__bybit_client;
}

// --- Interní ---

async function loadKlineHistory(client: BybitClient, symbol: string): Promise<void> {
  try {
    const result = await client.getKlines(symbol, "1", 100);
    const klines: BybitKline[] = (result.list || []).map((k: string[]) => ({
      start: parseInt(k[0]), end: parseInt(k[0]) + 60000,
      open: parseFloat(k[1]), high: parseFloat(k[2]),
      low: parseFloat(k[3]), close: parseFloat(k[4]),
      volume: parseFloat(k[5]), turnover: parseFloat(k[6]),
    })).reverse();
    getCandleBuffers().set(symbol, klines);
  } catch {
    getCandleBuffers().set(symbol, []);
  }
}

function subscribeInstrument(client: BybitClient, instrument: InstrumentConfig): void {
  client.subscribeTicker(instrument.symbol, (ticker: BybitTicker) => {
    const lastTick = { ...getState().lastTick, [ticker.symbol]: ticker };
    setState({ lastTick });
  });

  client.subscribeKline(instrument.symbol, "1", (kline: BybitKline) => {
    const buffer = getCandleBuffers().get(instrument.symbol) || [];
    if (buffer.length > 0 && buffer[buffer.length - 1].start === kline.start) {
      buffer[buffer.length - 1] = kline;
    } else {
      buffer.push(kline);
    }
    if (buffer.length > 100) buffer.shift();
    getCandleBuffers().set(instrument.symbol, buffer);
  });
}

async function periodicCheck(): Promise<void> {
  const state = getState();
  const config = getConfig();
  if (state.status !== "running") return;

  const client = globalState.__bybit_client;
  if (!client) return;

  await syncAndCheckPositions(client, config);

  if (!config.active) return;
  for (const inst of config.instruments.filter((i) => i.enabled)) {
    await evaluateInstrument(client, inst);
  }
}

async function syncAndCheckPositions(client: BybitClient, config: BotConfig): Promise<void> {
  try {
    const positions = await client.getPositions();
    const openPositions: Trade[] = positions.list
      .filter((p) => parseFloat(p.size) > 0)
      .map((p) => ({
        id: `pos_${p.symbol}_${p.side}`,
        symbol: p.symbol,
        direction: p.side === "Buy" ? "BUY" as const : "SELL" as const,
        volume: parseFloat(p.size),
        openPrice: parseFloat(p.avgPrice),
        openTime: Date.now(),
        sl: 0, tp: 0,
        profit: parseFloat(p.unrealisedPnl),
        status: "open" as const,
        signal: {
          type: (p.side === "Buy" ? "BUY" : "SELL") as "BUY" | "SELL",
          symbol: p.symbol, price: parseFloat(p.avgPrice), timestamp: Date.now(),
          confidence: 0, reasons: ["Sync"],
          indicators: { emaFast: 0, emaSlow: 0, rsi: 50, bbUpper: 0, bbMiddle: 0, bbLower: 0, atr: 0, volume: 0, timestamp: Date.now() },
        },
      }));

    // Server-side SL: zavři pozice s > 0.8% ztrátou (agresivnější SL)
    for (const pos of openPositions) {
      const posValue = pos.openPrice * pos.volume;
      const lossPercent = posValue > 0 ? (Math.abs(pos.profit || 0) / posValue) * 100 : 0;
      if ((pos.profit || 0) < 0 && lossPercent > 0.8) {
        console.log(`[SL] Zavírám ${pos.symbol} ${pos.direction} — ztráta ${pos.profit?.toFixed(2)} (${lossPercent.toFixed(1)}%)`);
        try {
          await client.closePosition(pos.symbol, pos.direction === "BUY" ? "Buy" : "Sell", pos.volume.toString());
          saveTrade({ ...pos, status: "closed", closeTime: Date.now(), profit: pos.profit || 0 });
        } catch (err) {
          console.error(`[SL] Chyba: ${err instanceof Error ? err.message : err}`);
        }
      }
      // Server-side TP: zavři pozice s > 0.5% ziskem
      if ((pos.profit || 0) > 0 && lossPercent > 0.5) {
        console.log(`[TP] Zavírám ${pos.symbol} ${pos.direction} — zisk ${pos.profit?.toFixed(2)} (${lossPercent.toFixed(1)}%)`);
        try {
          await client.closePosition(pos.symbol, pos.direction === "BUY" ? "Buy" : "Sell", pos.volume.toString());
          saveTrade({ ...pos, status: "closed", closeTime: Date.now(), profit: pos.profit || 0 });
        } catch (err) {
          console.error(`[TP] Chyba: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    // Detekuj zavřené pozice
    const prevPositions = getState().openPositions;
    for (const prev of prevPositions) {
      const stillOpen = openPositions.find((p) => p.symbol === prev.symbol && p.direction === prev.direction);
      if (!stillOpen) {
        saveTrade({ ...prev, status: "closed", closeTime: Date.now(), closePrice: 0, profit: prev.profit || 0 });
        console.log(`[CLOSED] ${prev.symbol} ${prev.direction} P&L: ${prev.profit?.toFixed(2)}`);
      }
    }

    // Refresh open positions
    const freshPositions = positions.list
      .filter((p) => parseFloat(p.size) > 0)
      .map((p) => ({
        id: `pos_${p.symbol}_${p.side}`,
        symbol: p.symbol,
        direction: p.side === "Buy" ? "BUY" as const : "SELL" as const,
        volume: parseFloat(p.size),
        openPrice: parseFloat(p.avgPrice),
        openTime: Date.now(),
        sl: 0, tp: 0,
        profit: parseFloat(p.unrealisedPnl),
        status: "open" as const,
        signal: {
          type: (p.side === "Buy" ? "BUY" : "SELL") as "BUY" | "SELL",
          symbol: p.symbol, price: parseFloat(p.avgPrice), timestamp: Date.now(),
          confidence: 0, reasons: ["Sync"],
          indicators: { emaFast: 0, emaSlow: 0, rsi: 50, bbUpper: 0, bbMiddle: 0, bbLower: 0, atr: 0, volume: 0, timestamp: Date.now() },
        },
      }));

    const todayPnL = freshPositions.reduce((sum, p) => sum + (p.profit || 0), 0);
    setState({ openPositions: freshPositions, todayPnL });

    // Kill switch
    if (todayPnL <= -config.risk.maxDailyLoss) {
      console.log(`[KILL SWITCH] Denní ztráta ${todayPnL.toFixed(2)} USDT`);
      for (const pos of freshPositions) {
        try {
          await client.closePosition(pos.symbol, pos.direction === "BUY" ? "Buy" : "Sell", pos.volume.toString());
          saveTrade({ ...pos, status: "closed", closeTime: Date.now(), profit: pos.profit || 0 });
        } catch { /* ok */ }
      }
      setState({ status: "killed", error: `Kill switch: ztráta ${todayPnL.toFixed(2)} USDT` });
    }
  } catch {
    // API chyba — přeskočit
  }
}

async function evaluateInstrument(client: BybitClient, instrument: InstrumentConfig): Promise<void> {
  const klines = getCandleBuffers().get(instrument.symbol);
  if (!klines || klines.length < 50) return;

  const state = getState();
  const config = getConfig();
  const lastTick = state.lastTick?.[instrument.symbol];
  if (!lastTick) return;

  const currentPrice = lastTick.lastPrice;
  const candles = klines.map(klineToCandle);
  const signal = generateSignal(instrument.symbol, candles, currentPrice, config.strategy);

  const signals = [...state.signals.filter((s) => s.symbol !== instrument.symbol), signal];
  setState({ signals });

  if (signal.type === "HOLD") return;

  const riskCheck = checkRisk(signal, state.openPositions, state.todayTrades, state.todayPnL, config.risk);
  if (!riskCheck.allowed) return;

  // Dynamický position sizing
  const recentTrades = getTrades().slice(-10).map((t) => ({ profit: t.profit || 0 }));
  const adjustedVolume = dynamicPositionSize(instrument.volume, recentTrades);

  // Garantovaný SL/TP
  const { sl, tp } = calculateSLTP(signal, instrument, signal.indicators.atr);

  try {
    const result = await client.placeOrder({
      symbol: instrument.symbol,
      side: signal.type === "BUY" ? "Buy" : "Sell",
      orderType: "Market",
      qty: adjustedVolume.toFixed(0),
      stopLoss: sl.toFixed(2),
      takeProfit: tp.toFixed(2),
    });

    const trade: Trade = {
      id: `trade_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      orderId: result.orderId,
      symbol: signal.symbol,
      direction: signal.type as "BUY" | "SELL",
      volume: adjustedVolume,
      openPrice: signal.price,
      openTime: Date.now(),
      sl, tp,
      status: "open",
      signal,
    };

    saveTrade(trade);
    console.log(`[TRADE] ${signal.type} ${instrument.symbol} @ ${signal.price} | Vol: ${adjustedVolume} | SL: ${sl.toFixed(2)} TP: ${tp.toFixed(2)} | Conf: ${(signal.confidence * 100).toFixed(0)}%`);

    setState({
      openPositions: [...state.openPositions, trade],
      todayTrades: [...state.todayTrades, trade],
    });
  } catch (err) {
    console.error(`[TRADE ERROR] ${err instanceof Error ? err.message : err}`);
  }
}
