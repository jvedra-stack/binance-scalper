// ============================================================
// Server-side singleton pro Bybit spojení
// ============================================================

import { BybitClient } from "./client";
import { generateSignal } from "@/lib/strategy/scalping";
import { checkRisk, calculateSLTP } from "@/lib/risk/manager";
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

// Adaptér: Bybit kline → formát pro strategii (kompatibilní s XTBCandleRecord)
function klineToCandle(k: BybitKline) {
  return { close: k.close, ctm: k.start, ctmString: "", high: k.high, low: k.low, open: k.open, vol: k.volume };
}

const globalState = globalThis as unknown as {
  __bybit_client?: BybitClient;
  __bybit_state?: EngineState;
  __bybit_config?: BotConfig;
  __bybit_candles?: Map<string, BybitKline[]>;
  __bybit_trades?: Trade[];
  __bybit_check_interval?: ReturnType<typeof setInterval>;
  __bybit_listeners?: Array<(event: string, data: unknown) => void>;
};

function getState(): EngineState {
  if (!globalState.__bybit_state) {
    globalState.__bybit_state = {
      status: "stopped",
      openPositions: [],
      todayTrades: [],
      todayPnL: 0,
      signals: [],
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
    // Env vars mají prioritu
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

function getTrades(): Trade[] {
  if (!globalState.__bybit_trades) globalState.__bybit_trades = [];
  return globalState.__bybit_trades;
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

    // Test connection + auth
    const balance = await client.getBalance();
    const totalEquity = parseFloat(balance.list?.[0]?.totalEquity || "0");

    await client.connectPublicWs();
    globalState.__bybit_client = client;

    client.setDisconnectHandler(() => {
      setState({ status: "error", error: "Odpojeno od Bybit" });
      stopEngine();
    });

    // Načti historické kline
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
          id: `bybit_${p.symbol}_${p.side}`,
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
            confidence: 0, reasons: ["Synchronizováno z Bybit"],
            indicators: { emaFast: 0, emaSlow: 0, rsi: 50, bbUpper: 0, bbMiddle: 0, bbLower: 0, atr: 0, volume: 0, timestamp: Date.now() },
          },
        }));
      setState({ openPositions });
    } catch { /* ok */ }

    setState({ status: "running", connectedAt: Date.now(), error: undefined, balance: totalEquity });

    if (globalState.__bybit_check_interval) clearInterval(globalState.__bybit_check_interval);
    globalState.__bybit_check_interval = setInterval(() => periodicCheck(), 5000);

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
    const result = await client.getKlines(symbol, "1", 200);
    // Bybit vrací klines jako string[][] ve formátu [startTime, open, high, low, close, volume, turnover]
    const klines: BybitKline[] = (result.list || []).map((k: string[]) => ({
      start: parseInt(k[0]),
      end: parseInt(k[0]) + 60000,
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      turnover: parseFloat(k[6]),
    })).reverse(); // Bybit vrací od nejnovější, my chceme od nejstarší

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
    if (buffer.length > 200) buffer.shift();
    getCandleBuffers().set(instrument.symbol, buffer);
  });
}

async function periodicCheck(): Promise<void> {
  const state = getState();
  const config = getConfig();
  if (state.status !== "running") return;

  const client = globalState.__bybit_client;
  if (!client) return;

  // Sync pozic z Binance a kontrola SL/TP
  await syncAndCheckPositions(client, config);

  // Generuj signály a obchoduj jen pokud je aktivní
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
        id: `bybit_${p.symbol}_${p.side}`,
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

    // Server-side stop-loss: zavři pozice s > 1% ztrátou
    for (const pos of openPositions) {
      const lossPercent = pos.openPrice > 0
        ? (Math.abs(pos.profit || 0) / (pos.openPrice * pos.volume)) * 100
        : 0;
      if ((pos.profit || 0) < 0 && lossPercent > 1) {
        console.log(`[SL] Zavírám ${pos.symbol} ${pos.direction} — ztráta ${pos.profit?.toFixed(2)} (${lossPercent.toFixed(1)}%)`);
        try {
          await client.closePosition(pos.symbol, pos.direction === "BUY" ? "Buy" : "Sell", pos.volume.toString());
        } catch (err) {
          console.error(`[SL] Chyba při zavírání: ${err instanceof Error ? err.message : err}`);
        }
      }
    }

    // Update P&L
    const todayPnL = openPositions.reduce((sum, p) => sum + (p.profit || 0), 0);
    setState({ openPositions, todayPnL });

    // Kill switch
    if (todayPnL <= -config.risk.maxDailyLoss) {
      console.log(`[KILL SWITCH] Denní ztráta ${todayPnL.toFixed(2)} překročila limit -${config.risk.maxDailyLoss}`);
      for (const pos of openPositions) {
        try {
          await client.closePosition(pos.symbol, pos.direction === "BUY" ? "Buy" : "Sell", pos.volume.toString());
        } catch { /* ok */ }
      }
      setState({ status: "killed", error: `Kill switch: denní ztráta ${todayPnL.toFixed(2)} USDT` });
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

  // Execute trade
  const { sl, tp } = calculateSLTP(signal, instrument, signal.indicators.atr);
  try {
    const result = await client.placeOrder({
      symbol: instrument.symbol,
      side: signal.type === "BUY" ? "Buy" : "Sell",
      orderType: "Market",
      qty: instrument.volume.toString(),
      stopLoss: sl.toFixed(2),
      takeProfit: tp.toFixed(2),
    });

    const trade: Trade = {
      id: `trade_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      orderId: result.orderId,
      symbol: signal.symbol,
      direction: signal.type as "BUY" | "SELL",
      volume: instrument.volume,
      openPrice: signal.price,
      openTime: Date.now(),
      sl, tp,
      status: "open",
      signal,
    };

    getTrades().push(trade);
    setState({
      openPositions: [...state.openPositions, trade],
      todayTrades: [...state.todayTrades, trade],
    });
  } catch (err) {
    console.error(`[TRADE ERROR] ${err instanceof Error ? err.message : err}`);
  }
}
