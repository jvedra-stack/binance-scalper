// ============================================================
// Server-side singleton pro Binance Futures spojení
// S garantovaným SL/TP, trade persistencí a dynamickým sizingem
// ============================================================

import { BybitClient } from "./client";
import { generateSignal, dynamicPositionSize } from "@/lib/strategy/scalping";
import { checkRisk, calculateSLTP, calculateTrailingStop, isTrailingStopHit, isTradeWorthIt, type TrailingState } from "@/lib/risk/manager";
import { loadServerTrades, saveServerTrades, addServerTrade, getTodayPnL } from "@/lib/server-store";
import { computeCorrelationMatrix, checkCorrelationRisk, type CorrelationMatrix } from "@/lib/strategy/correlation";
import { analyzeFundingRate, type FundingRateData, type FundingSignal } from "@/lib/strategy/funding";
import { extractFeatures, logTradeFeatures, trainModel, predictWinProbability, loadModel, type MLModel } from "@/lib/ml/model";
import { notifyTradeOpen, notifyTradeClose, notifyKillSwitch, sendDailyReport } from "@/lib/notifications/telegram";
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

// Multi-timeframe intervaly pro analýzu
const MTF_INTERVALS = ["5m", "15m"] as const;
type MTFInterval = typeof MTF_INTERVALS[number];

const globalState = globalThis as unknown as {
  __bybit_client?: BybitClient;
  __bybit_state?: EngineState;
  __bybit_config?: BotConfig;
  __bybit_candles?: Map<string, BybitKline[]>;
  __bybit_candles_mtf?: Map<string, BybitKline[]>; // klíč: "BTCUSDT:5m"
  __bybit_correlation?: CorrelationMatrix;
  __bybit_funding?: Map<string, FundingSignal>;
  __bybit_trailing?: Map<string, TrailingState>;
  __bybit_partialTP?: Set<string>;
  __bybit_manual_stop?: boolean; // flag pro rozlišení ruční stop vs WS disconnect
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

function getMTFCandleBuffers(): Map<string, BybitKline[]> {
  if (!globalState.__bybit_candles_mtf) globalState.__bybit_candles_mtf = new Map();
  return globalState.__bybit_candles_mtf;
}

// Public API pro přístup k multi-timeframe datům
export function getMTFCandles(symbol: string, interval: string): BybitKline[] {
  return getMTFCandleBuffers().get(`${symbol}:${interval}`) || [];
}

// Trade historie — načítá se z JSON souboru na serveru
function getTrades(): Trade[] {
  return loadServerTrades();
}

function saveTrade(trade: Trade): void {
  addServerTrade(trade);

  // ML: loguj features při zavření pozice
  if (trade.status === "closed" && trade.signal && trade.signal.indicators.emaFast > 0) {
    try {
      const features = extractFeatures(
        trade.signal.indicators,
        trade.signal.price,
        trade.signal.confidence,
        trade.direction
      );
      logTradeFeatures({ ...features, won: (trade.profit || 0) > 0 });
    } catch { /* ok */ }
  }
}

/**
 * Zavře existující trade záznam — najde původní "open" trade a aktualizuje ho.
 * Pokud nenajde, uloží nový záznam.
 */
function closeTradeRecord(pos: Trade, closePrice: number, profit: number): void {
  const trades = loadServerTrades();
  // Najdi původní otevřený záznam (trade_* id, ne pos_*)
  const openIdx = trades.findIndex(
    (t) => t.status === "open" && t.symbol === pos.symbol && t.direction === pos.direction
  );
  if (openIdx >= 0) {
    trades[openIdx] = {
      ...trades[openIdx],
      status: "closed",
      closeTime: Date.now(),
      closePrice,
      profit,
    };
    saveServerTrades(trades);
    // ML logging
    const closed = trades[openIdx];
    if (closed.signal && closed.signal.indicators.emaFast > 0) {
      try {
        const features = extractFeatures(closed.signal.indicators, closed.signal.price, closed.signal.confidence, closed.direction);
        logTradeFeatures({ ...features, won: profit > 0 });
      } catch { /* ok */ }
    }
  } else {
    saveTrade({ ...pos, status: "closed", closeTime: Date.now(), closePrice, profit });
  }
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
export function getCorrelationMatrix(): CorrelationMatrix | undefined { return globalState.__bybit_correlation; }
export function getFundingSignals(): Map<string, FundingSignal> {
  if (!globalState.__bybit_funding) globalState.__bybit_funding = new Map();
  return globalState.__bybit_funding;
}

export async function closeSinglePosition(symbol: string, direction: "BUY" | "SELL"): Promise<void> {
  const client = globalState.__bybit_client;
  if (!client) throw new Error("Bot neběží");

  const pos = getState().openPositions.find(
    (p) => p.symbol === symbol && p.direction === direction
  );
  if (!pos) throw new Error(`Pozice ${symbol} ${direction} nenalezena`);

  try {
    await client.closePosition(symbol, direction === "BUY" ? "Buy" : "Sell", pos.volume.toString());
    const tick = getState().lastTick?.[symbol];
    closeTradeRecord(pos, tick?.lastPrice || pos.openPrice, pos.profit || 0);
    console.log(`[CLOSE SINGLE] ${symbol} ${direction} P&L: ${pos.profit?.toFixed(2)}`);
    setState({
      openPositions: getState().openPositions.filter(
        (p) => !(p.symbol === symbol && p.direction === direction)
      ),
    });
  } catch (err) {
    console.error(`[CLOSE SINGLE] Chyba: ${err instanceof Error ? err.message : err}`);
    throw err;
  }
}

export async function closeAllPositions(): Promise<void> {
  const client = globalState.__bybit_client;
  if (!client) return;
  for (const pos of getState().openPositions) {
    try {
      await client.closePosition(pos.symbol, pos.direction === "BUY" ? "Buy" : "Sell", pos.volume.toString());
      const tick = getState().lastTick?.[pos.symbol];
      closeTradeRecord(pos, tick?.lastPrice || pos.openPrice, pos.profit || 0);
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
  if (globalState.__bybit_client?.isConnected) {
    globalState.__bybit_manual_stop = true; // starý engine se stopne manuálně
    stopEngine();
  }
  globalState.__bybit_manual_stop = false; // nový engine = ne manuální stop
  globalState.__bybit_config = config;
  setState({ status: "connecting", error: undefined });

  try {
    const client = new BybitClient(config.credentials);
    const balance = await client.getBalance();
    const totalEquity = parseFloat(balance.list?.[0]?.totalEquity || "0");

    await client.connectPublicWs();
    globalState.__bybit_client = client;

    client.setDisconnectHandler(() => {
      // Pokud byl ruční stop, NERECONNECTUJ
      if (globalState.__bybit_manual_stop) {
        console.log("[WS] Odpojeno (ruční stop) — nereconnectuji");
        return;
      }

      console.log("[WS] Odpojeno od Binance — pokus o reconnect za 5s...");
      setState({ status: "connecting", error: "Odpojeno — reconnecting..." });

      setTimeout(async () => {
        try {
          // Znovu zkontroluj — mohl přijít manual stop mezitím
          if (globalState.__bybit_manual_stop) return;
          const currentConfig = getConfig();
          if (currentConfig) {
            console.log("[WS] Reconnecting...");
            await startEngine(currentConfig);
            console.log("[WS] Reconnect úspěšný!");
          }
        } catch (err) {
          console.error(`[WS] Reconnect selhal: ${err instanceof Error ? err.message : err}`);
          setState({ status: "error", error: `Reconnect selhal: ${err instanceof Error ? err.message : err}` });
          // Druhý pokus za 30s
          setTimeout(async () => {
            try {
              if (globalState.__bybit_manual_stop) return;
              const cfg = getConfig();
              if (cfg && getState().status !== "running") {
                console.log("[WS] Druhý pokus o reconnect...");
                await startEngine(cfg);
              }
            } catch {
              setState({ status: "error", error: "Reconnect selhal — restartuj ručně" });
            }
          }, 30000);
        }
      }, 5000);
    });

    const enabled = config.instruments.filter((i) => i.enabled);

    // Nastav leverage 20x na všech instrumentech
    for (const inst of enabled) {
      try {
        await client.setLeverage(inst.symbol, "20");
        console.log(`[LEVERAGE] ${inst.symbol} nastaven na 20x`);
      } catch { /* může selhat pokud už je nastavený */ }
    }

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
            indicators: { emaFast: 0, emaSlow: 0, rsi: 50, bbUpper: 0, bbMiddle: 0, bbLower: 0, atr: 0, volume: 0, stochRsi: 50, timestamp: Date.now() },
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
  globalState.__bybit_manual_stop = true; // Signalizuj ruční stop
  if (globalState.__bybit_check_interval) {
    clearInterval(globalState.__bybit_check_interval);
    globalState.__bybit_check_interval = undefined;
  }
  globalState.__bybit_client?.disconnect();
  globalState.__bybit_client = undefined;
  getCandleBuffers().clear();
  getMTFCandleBuffers().clear();
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

  // Načti historii pro multi-timeframe
  for (const iv of MTF_INTERVALS) {
    try {
      const result = await client.getKlines(symbol, iv, 100);
      const klines: BybitKline[] = (result.list || []).map((k: string[]) => ({
        start: parseInt(k[0]), end: parseInt(k[0]) + 60000,
        open: parseFloat(k[1]), high: parseFloat(k[2]),
        low: parseFloat(k[3]), close: parseFloat(k[4]),
        volume: parseFloat(k[5]), turnover: parseFloat(k[6]),
      })).reverse();
      getMTFCandleBuffers().set(`${symbol}:${iv}`, klines);
    } catch {
      getMTFCandleBuffers().set(`${symbol}:${iv}`, []);
    }
  }
}

function subscribeInstrument(client: BybitClient, instrument: InstrumentConfig): void {
  client.subscribeTicker(instrument.symbol, (ticker: BybitTicker) => {
    const lastTick = { ...getState().lastTick, [ticker.symbol]: ticker };
    setState({ lastTick });
  });

  // 1m kline (primární)
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

  // Multi-timeframe klines (5m, 15m)
  for (const iv of MTF_INTERVALS) {
    client.subscribeKline(instrument.symbol, iv, (kline: BybitKline) => {
      const key = `${instrument.symbol}:${iv}`;
      const buffer = getMTFCandleBuffers().get(key) || [];
      if (buffer.length > 0 && buffer[buffer.length - 1].start === kline.start) {
        buffer[buffer.length - 1] = kline;
      } else {
        buffer.push(kline);
      }
      if (buffer.length > 100) buffer.shift();
      getMTFCandleBuffers().set(key, buffer);
    });
  }
}

async function periodicCheck(): Promise<void> {
  const state = getState();
  const config = getConfig();
  if (state.status !== "running") return;

  const client = globalState.__bybit_client;
  if (!client) return;

  await syncAndCheckPositions(client, config);

  // Přepočítej korelační matici každých 8s (spolu s periodic check)
  const enabledSymbols = config.instruments.filter((i) => i.enabled).map((i) => i.symbol);
  if (enabledSymbols.length >= 2) {
    globalState.__bybit_correlation = computeCorrelationMatrix(getCandleBuffers(), enabledSymbols);
  }

  // Funding rate refresh (jednou za ~40s — každý 5. periodic check)
  const checkCount = (globalState as Record<string, number>).__bybit_check_count || 0;
  (globalState as Record<string, number>).__bybit_check_count = checkCount + 1;
  if (checkCount % 5 === 0) {
    // Denní report — jednou denně kolem 23:55
    const now = new Date();
    if (now.getHours() === 23 && now.getMinutes() >= 55 && now.getMinutes() < 56 && checkCount % 7 === 0) {
      try {
        const todayTrades = getTrades().filter((t) => {
          const tradeDate = new Date(t.openTime);
          return tradeDate.toDateString() === now.toDateString();
        });
        const todayPnLTotal = todayTrades
          .filter((t) => t.status === "closed")
          .reduce((sum, t) => sum + (t.profit || 0), 0);
        await sendDailyReport(todayTrades, todayPnLTotal, state.balance);
      } catch { /* ok */ }
    }

    // ML: přetrénuj model každých ~5 minut (každý 37. check)
    if (checkCount % 37 === 0) {
      try { trainModel(); } catch { /* ok */ }
    }

    try {
      const fundingData = await client.getAllFundingRates();
      const fundingMap = getFundingSignals();
      for (const inst of config.instruments.filter((i) => i.enabled)) {
        const fd = fundingData.find((f) => f.symbol === inst.symbol);
        if (fd) {
          const signal = analyzeFundingRate({
            symbol: inst.symbol,
            fundingRate: parseFloat(fd.fundingRate),
            fundingTime: fd.fundingTime,
            markPrice: parseFloat(fd.markPrice),
            timestamp: Date.now(),
          });
          fundingMap.set(inst.symbol, signal);
        }
      }
    } catch { /* ok — nefatální */ }
  }

  if (!config.active) return;
  for (const inst of config.instruments.filter((i) => i.enabled)) {
    await evaluateInstrument(client, inst);
  }

  // Funding Rate jako samostatná strategie
  // Extrémní funding (> 0.03%) → otevři protisměrnou pozici
  await evaluateFundingArbitrage(client, config);
}

async function evaluateFundingArbitrage(client: BybitClient, config: BotConfig): Promise<void> {
  const fundingMap = getFundingSignals();
  const state = getState();

  for (const inst of config.instruments.filter((i) => i.enabled)) {
    const fs = fundingMap.get(inst.symbol);
    if (!fs || fs.type === "NEUTRAL") continue;

    // Pouze extrémní funding rate (> 0.03%)
    if (Math.abs(fs.fundingRate) < 0.0003) continue;

    // Směr: jdi PROTI davu
    const direction: "BUY" | "SELL" = fs.type === "FUNDING_SHORT" ? "SELL" : "BUY";

    // Zkontroluj jestli už nemáme pozici na tomto symbolu
    const existing = state.openPositions.find(
      (p) => p.symbol === inst.symbol && p.direction === direction
    );
    if (existing) continue;

    // Risk check
    const fundingSignal = {
      type: direction, symbol: inst.symbol, price: 0, timestamp: Date.now(),
      confidence: 0.7, reasons: [`Funding arb: ${fs.reason}`],
      indicators: { emaFast: 0, emaSlow: 0, rsi: 50, bbUpper: 0, bbMiddle: 0, bbLower: 0, atr: 0, volume: 0, stochRsi: 50, timestamp: Date.now() },
    };
    const riskCheck = checkRisk(fundingSignal, state.openPositions, state.todayTrades, state.todayPnL, config.risk);
    if (!riskCheck.allowed) continue;

    const lastTick = state.lastTick?.[inst.symbol];
    if (!lastTick) continue;
    const currentPrice = lastTick.lastPrice;

    // Menší pozice (50% normální) s tighter SL
    const volumeUSDT = inst.volume * 0.5;
    const qtyInCoins = volumeUSDT / currentPrice;

    let qtyPrecision = 3;
    let pricePrecision = 2;
    let minQty = 0.001;
    try {
      const instrumentsData = await client.getInstruments();
      const info = instrumentsData.list.find((i) => i.symbol === inst.symbol);
      if (info) {
        const step = parseFloat(info.lotSizeFilter.qtyStep);
        qtyPrecision = step < 1 ? Math.ceil(-Math.log10(step)) : 0;
        minQty = parseFloat(info.lotSizeFilter.minOrderQty);
        const tick = parseFloat(info.priceFilter.tickSize);
        pricePrecision = tick < 1 ? Math.ceil(-Math.log10(tick)) : 0;
      }
    } catch { /* default */ }

    const stepSize = Math.pow(10, -qtyPrecision);
    const adjustedQty = Math.max(minQty, parseFloat((Math.floor(qtyInCoins / stepSize) * stepSize).toFixed(qtyPrecision)));

    // Tighter SL (0.3%), wider TP (0.6%) pro funding arb
    const slDist = currentPrice * 0.003;
    const tpDist = currentPrice * 0.006;
    const sl = direction === "BUY" ? currentPrice - slDist : currentPrice + slDist;
    const tp = direction === "BUY" ? currentPrice + tpDist : currentPrice - tpDist;

    try {
      const result = await client.placeOrder({
        symbol: inst.symbol,
        side: direction === "BUY" ? "Buy" : "Sell",
        orderType: "Market",
        qty: adjustedQty.toFixed(qtyPrecision),
        stopLoss: sl.toFixed(pricePrecision),
        takeProfit: tp.toFixed(pricePrecision),
      });

      const trade: Trade = {
        id: `funding_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        orderId: result.orderId,
        symbol: inst.symbol,
        direction,
        volume: adjustedQty,
        openPrice: currentPrice,
        openTime: Date.now(),
        sl, tp,
        status: "open",
        signal: { ...fundingSignal, price: currentPrice },
      };

      saveTrade(trade);
      console.log(`[FUNDING ARB] ${direction} ${inst.symbol} @ ${currentPrice} | FR: ${(fs.fundingRate * 100).toFixed(4)}% | Qty: ${adjustedQty} (${volumeUSDT.toFixed(0)} USDT)`);
      notifyTradeOpen(trade).catch(() => {});

      setState({
        openPositions: [...state.openPositions, trade],
        todayTrades: [...state.todayTrades, trade],
      });
    } catch (err) {
      console.error(`[FUNDING ARB ERROR] ${err instanceof Error ? err.message : err}`);
    }
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
          indicators: { emaFast: 0, emaSlow: 0, rsi: 50, bbUpper: 0, bbMiddle: 0, bbLower: 0, atr: 0, volume: 0, stochRsi: 50, timestamp: Date.now() },
        },
      }));

    // Trailing stop tracking
    if (!globalState.__bybit_trailing) globalState.__bybit_trailing = new Map();
    const trailingMap = globalState.__bybit_trailing;

    // Partial TP tracking — pozice kde už se zavřela polovina
    if (!globalState.__bybit_partialTP) globalState.__bybit_partialTP = new Set<string>();
    const partialTPSet = globalState.__bybit_partialTP as Set<string>;

    for (const pos of openPositions) {
      const posValue = pos.openPrice * pos.volume;
      const lossPercent = posValue > 0 ? (Math.abs(pos.profit || 0) / posValue) * 100 : 0;
      const tick = getState().lastTick?.[pos.symbol];
      const currentPrice = tick?.lastPrice || pos.openPrice;

      // Trailing stop logika
      const trailKey = `${pos.symbol}_${pos.direction}`;
      let trailState = trailingMap.get(trailKey) || {
        symbol: pos.symbol,
        direction: pos.direction,
        highWaterMark: 0,
        breakevenActivated: false,
        trailingActivated: false,
        currentTrailingStop: 0,
      };

      if (config.risk.trailingStop) {
        trailState = calculateTrailingStop(
          trailState, currentPrice, pos.openPrice, config.risk.trailingStopPercent
        );
        trailingMap.set(trailKey, trailState);

        // Trailing stop hit → zavři pozici
        if (isTrailingStopHit(trailState, currentPrice)) {
          console.log(`[TRAILING SL] ${pos.symbol} ${pos.direction} @ ${currentPrice.toFixed(2)} (trail: ${trailState.currentTrailingStop.toFixed(2)})`);
          try {
            await client.closePosition(pos.symbol, pos.direction === "BUY" ? "Buy" : "Sell", pos.volume.toString());
            closeTradeRecord(pos, currentPrice, pos.profit || 0);
            trailingMap.delete(trailKey);
          } catch (err) {
            console.error(`[TRAILING SL] Chyba: ${err instanceof Error ? err.message : err}`);
          }
          continue;
        }
      }

      // Server-side SL: zavři pozice s > 0.6% ztrátou
      if ((pos.profit || 0) < 0 && lossPercent > 0.6) {
        console.log(`[SL] Zavírám ${pos.symbol} ${pos.direction} — ztráta ${pos.profit?.toFixed(2)} (${lossPercent.toFixed(1)}%)`);
        try {
          await client.closePosition(pos.symbol, pos.direction === "BUY" ? "Buy" : "Sell", pos.volume.toString());
          closeTradeRecord(pos, currentPrice, pos.profit || 0);
          trailingMap.delete(trailKey);
        } catch (err) {
          console.error(`[SL] Chyba: ${err instanceof Error ? err.message : err}`);
        }
      }
      // Partial TP: na 0.5% zisku zavři 50% pozice, zbytek nech na trailing
      const partialKey = `${pos.symbol}_${pos.direction}`;
      if ((pos.profit || 0) > 0 && lossPercent > 0.5 && !partialTPSet.has(partialKey)) {
        const halfQty = (pos.volume / 2);
        if (halfQty > 0) {
          console.log(`[PARTIAL TP] ${pos.symbol} ${pos.direction} — zavírám 50% @ ${currentPrice.toFixed(2)} (zisk ${lossPercent.toFixed(1)}%)`);
          try {
            await client.closePosition(pos.symbol, pos.direction === "BUY" ? "Buy" : "Sell", halfQty.toString());
            partialTPSet.add(partialKey);
          } catch (err) {
            console.error(`[PARTIAL TP] Chyba: ${err instanceof Error ? err.message : err}`);
          }
        }
      }

      // Server-side TP: zavři pozice s > 1.0% ziskem (pokud trailing neběží)
      if (!trailState.trailingActivated && (pos.profit || 0) > 0 && lossPercent > 1.0) {
        console.log(`[TP] Zavírám ${pos.symbol} ${pos.direction} — zisk ${pos.profit?.toFixed(2)} (${lossPercent.toFixed(1)}%)`);
        try {
          await client.closePosition(pos.symbol, pos.direction === "BUY" ? "Buy" : "Sell", pos.volume.toString());
          closeTradeRecord(pos, currentPrice, pos.profit || 0);
          trailingMap.delete(trailKey);
          partialTPSet.delete(partialKey);
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
        const tick = getState().lastTick?.[prev.symbol];
        closeTradeRecord(prev, tick?.lastPrice || prev.openPrice, prev.profit || 0);
        console.log(`[CLOSED] ${prev.symbol} ${prev.direction} P&L: ${prev.profit?.toFixed(2)}`);
        notifyTradeClose({ ...prev, status: "closed", closeTime: Date.now(), profit: prev.profit || 0 }).catch(() => {});
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
          indicators: { emaFast: 0, emaSlow: 0, rsi: 50, bbUpper: 0, bbMiddle: 0, bbLower: 0, atr: 0, volume: 0, stochRsi: 50, timestamp: Date.now() },
        },
      }));

    const unrealizedPnL = freshPositions.reduce((sum, p) => sum + (p.profit || 0), 0);
    const realizedPnL = getTodayPnL();
    const todayPnL = unrealizedPnL + realizedPnL;
    setState({ openPositions: freshPositions, todayPnL });

    // Kill switch
    if (todayPnL <= -config.risk.maxDailyLoss) {
      console.log(`[KILL SWITCH] Denní ztráta ${todayPnL.toFixed(2)} USDT`);
      for (const pos of freshPositions) {
        try {
          await client.closePosition(pos.symbol, pos.direction === "BUY" ? "Buy" : "Sell", pos.volume.toString());
          closeTradeRecord(pos, pos.openPrice, pos.profit || 0);
        } catch { /* ok */ }
      }
      setState({ status: "killed", error: `Kill switch: ztráta ${todayPnL.toFixed(2)} USDT` });
      notifyKillSwitch(todayPnL).catch(() => {});
    }
  } catch {
    // API chyba — přeskočit
  }
}

async function evaluateInstrument(client: BybitClient, instrument: InstrumentConfig): Promise<void> {
  // Primární TF = 5min (méně šumu než 1min)
  const klines5m = getMTFCandleBuffers().get(`${instrument.symbol}:5m`);
  if (!klines5m || klines5m.length < 50) return;

  const state = getState();
  const config = getConfig();
  const lastTick = state.lastTick?.[instrument.symbol];
  if (!lastTick) return;

  const currentPrice = lastTick.lastPrice;

  // Spread filtr — neobchoduj při vysokém spreadu (> 0.05%)
  if (lastTick.ask1Price > 0 && lastTick.bid1Price > 0) {
    const spreadPercent = ((lastTick.ask1Price - lastTick.bid1Price) / currentPrice) * 100;
    if (spreadPercent > 0.05) {
      return; // spread příliš vysoký
    }
  }

  const candles = klines5m.map(klineToCandle);

  // MTF confluence: 1min pro timing, 15min pro vyšší trend
  const mtfCandles: Record<string, typeof candles> = {};
  const klines1m = getCandleBuffers().get(instrument.symbol);
  if (klines1m && klines1m.length >= 30) {
    mtfCandles["1m"] = klines1m.map(klineToCandle);
  }
  const klines15m = getMTFCandleBuffers().get(`${instrument.symbol}:15m`);
  if (klines15m && klines15m.length >= 30) {
    mtfCandles["15m"] = klines15m.map(klineToCandle);
  }

  const signal = generateSignal(instrument.symbol, candles, currentPrice, config.strategy, mtfCandles);

  // Funding rate modifikátor
  const fundingSignal = getFundingSignals().get(instrument.symbol);
  if (fundingSignal && fundingSignal.type !== "NEUTRAL") {
    signal.reasons.push(fundingSignal.reason);
    // Funding posiluje souhlasný signál, oslabuje protisměrný
    if (
      (fundingSignal.type === "FUNDING_SHORT" && signal.type === "SELL") ||
      (fundingSignal.type === "FUNDING_LONG" && signal.type === "BUY")
    ) {
      signal.confidence = Math.min(1, signal.confidence + fundingSignal.confidence);
      signal.reasons.push(`Funding rate posiluje ${signal.type} signál`);
    } else if (
      (fundingSignal.type === "FUNDING_SHORT" && signal.type === "BUY") ||
      (fundingSignal.type === "FUNDING_LONG" && signal.type === "SELL")
    ) {
      signal.confidence *= 0.85;
      signal.reasons.push(`Funding rate oslabuje ${signal.type} signál`);
    }
  }

  const signals = [...state.signals.filter((s) => s.symbol !== instrument.symbol), signal];
  setState({ signals });

  if (signal.type === "HOLD") {
    console.log(`[SIGNAL] ${instrument.symbol} HOLD (conf: ${(signal.confidence * 100).toFixed(0)}%)`);
    return;
  }

  console.log(`[SIGNAL] ${instrument.symbol} ${signal.type} conf: ${(signal.confidence * 100).toFixed(0)}%`);

  // Helper: zablokuj signál a aktualizuj v UI
  const blockSignal = (reason: string) => {
    signal.blocked = reason;
    const updatedSignals = [...getState().signals.filter((s) => s.symbol !== instrument.symbol), signal];
    setState({ signals: updatedSignals });
    console.log(`[BLOCKED] ${instrument.symbol} ${signal.type}: ${reason}`);
  };

  const riskCheck = checkRisk(signal, state.openPositions, state.todayTrades, state.todayPnL, config.risk);
  if (!riskCheck.allowed) {
    blockSignal(riskCheck.reason || "Risk check failed");
    return;
  }

  // ML predikce — uprav confidence na základě historické úspěšnosti
  const mlPrediction = predictWinProbability(
    signal.indicators, signal.price, signal.confidence, signal.type as "BUY" | "SELL"
  );
  if (mlPrediction !== null) {
    signal.reasons.push(`ML predikce: ${(mlPrediction * 100).toFixed(0)}% šance na výhru`);
    if (mlPrediction < 0.35) {
      signal.confidence *= 0.7; // ML říká nízká šance → oslabení
      signal.reasons.push("ML filtr: nízká predikce → confidence snížena");
    } else if (mlPrediction > 0.65) {
      signal.confidence = Math.min(1, signal.confidence * 1.15); // ML říká vysoká šance → posílení
      signal.reasons.push("ML boost: vysoká predikce → confidence zvýšena");
    }
  }

  // Korelační filtr — blokuj duplicitní expozice na korelovaných coinech
  if (globalState.__bybit_correlation) {
    const corrCheck = checkCorrelationRisk(
      instrument.symbol,
      signal.type as "BUY" | "SELL",
      state.openPositions,
      globalState.__bybit_correlation,
      0.7
    );
    if (!corrCheck.allowed) {
      blockSignal(corrCheck.reason || "Korelační filtr");
      return;
    }
  }

  // Fee-aware EV filtr — trade se vyplatí jen pokud expected value > 0
  const evCheck = isTradeWorthIt(signal.confidence, instrument.slPercent, instrument.tpPercent);
  if (!evCheck.worthIt) {
    blockSignal(`EV=${evCheck.expectedValue.toFixed(3)}% → nevyplatí se po fees`);
    return;
  }

  // Clear blocked flag — trade projde všemi filtry
  signal.blocked = undefined;

  // Dynamický position sizing (instrument.volume je v USDT)
  const recentTrades = getTrades().slice(-10).map((t) => ({ profit: t.profit || 0 }));
  const adjustedVolumeUSDT = dynamicPositionSize(instrument.volume, recentTrades);

  // Přepočet USDT → coiny (qty pro Binance musí být v coinech)
  const qtyInCoins = adjustedVolumeUSDT / currentPrice;
  console.log(`[SIZING] ${instrument.symbol} | config.volume=${instrument.volume} USDT | adjusted=${adjustedVolumeUSDT.toFixed(0)} USDT | price=${currentPrice} | qtyCoins=${qtyInCoins}`);

  // Zjisti precision pro qty a price
  let qtyPrecision = 3;
  let pricePrecision = 2;
  let minQty = 0.001;
  try {
    const instrumentsData = await client.getInstruments();
    const info = instrumentsData.list.find((i) => i.symbol === instrument.symbol);
    if (info) {
      const step = parseFloat(info.lotSizeFilter.qtyStep);
      qtyPrecision = step < 1 ? Math.ceil(-Math.log10(step)) : 0;
      minQty = parseFloat(info.lotSizeFilter.minOrderQty);
      const tick = parseFloat(info.priceFilter.tickSize);
      pricePrecision = tick < 1 ? Math.ceil(-Math.log10(tick)) : 0;
    }
  } catch { /* použij default */ }

  // Zaokrouhli qty na správný step a ověř minimum
  const stepSize = Math.pow(10, -qtyPrecision);
  const adjustedQty = Math.max(minQty, parseFloat((Math.floor(qtyInCoins / stepSize) * stepSize).toFixed(qtyPrecision)));

  // Garantovaný SL/TP
  const { sl, tp } = calculateSLTP(signal, instrument, signal.indicators.atr);

  try {
    const result = await client.placeOrder({
      symbol: instrument.symbol,
      side: signal.type === "BUY" ? "Buy" : "Sell",
      orderType: "Market",
      qty: adjustedQty.toFixed(qtyPrecision),
      stopLoss: sl.toFixed(pricePrecision),
      takeProfit: tp.toFixed(pricePrecision),
    });

    const trade: Trade = {
      id: `trade_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      orderId: result.orderId,
      symbol: signal.symbol,
      direction: signal.type as "BUY" | "SELL",
      volume: adjustedQty,
      openPrice: signal.price,
      openTime: Date.now(),
      sl, tp,
      status: "open",
      signal,
    };

    saveTrade(trade);
    console.log(`[TRADE] ${signal.type} ${instrument.symbol} @ ${signal.price} | Qty: ${adjustedQty} (${adjustedVolumeUSDT.toFixed(0)} USDT) | SL: ${sl.toFixed(pricePrecision)} TP: ${tp.toFixed(pricePrecision)} | Conf: ${(signal.confidence * 100).toFixed(0)}%`);
    notifyTradeOpen(trade).catch(() => {});

    setState({
      openPositions: [...state.openPositions, trade],
      todayTrades: [...state.todayTrades, trade],
    });
  } catch (err) {
    console.error(`[TRADE ERROR] ${err instanceof Error ? err.message : err}`);
  }
}
