// ============================================================
// Risk Management – ochrana kapitálu
// ============================================================

import type { RiskConfig, Trade, Signal, InstrumentConfig } from "@/types";

export interface RiskCheck {
  allowed: boolean;
  reason?: string;
}

export function checkRisk(
  signal: Signal,
  openPositions: Trade[],
  todayTrades: Trade[],
  todayPnL: number,
  config: RiskConfig
): RiskCheck {
  // 1. Kill switch – max denní ztráta
  if (todayPnL <= -config.maxDailyLoss) {
    return { allowed: false, reason: `Kill switch: denní ztráta ${todayPnL.toFixed(2)} USDT dosáhla limitu -${config.maxDailyLoss}` };
  }

  // 2. Max otevřených pozic
  if (openPositions.length >= config.maxOpenPositions) {
    return { allowed: false, reason: `Max otevřených pozic (${config.maxOpenPositions}) dosažen` };
  }

  // 3. Žádný duplicitní trade na stejném symbolu stejným směrem
  const duplicit = openPositions.find(
    (t) => t.symbol === signal.symbol && t.direction === signal.type
  );
  if (duplicit) {
    return { allowed: false, reason: `Již existuje otevřená ${signal.type} pozice na ${signal.symbol}` };
  }

  // 5. Dynamický cooldown — po prohře 120s, po výhře 15s
  const lastClosed = todayTrades
    .filter((t) => t.symbol === signal.symbol && t.status === "closed")
    .sort((a, b) => (b.closeTime || 0) - (a.closeTime || 0))[0];

  if (lastClosed && lastClosed.closeTime) {
    const wasLoss = (lastClosed.profit || 0) <= 0;
    const cooldownMs = wasLoss ? 120000 : 15000; // 120s po ztrátě, 15s po zisku
    const elapsed = Date.now() - lastClosed.closeTime;
    if (elapsed < cooldownMs) {
      return { allowed: false, reason: `Cooldown ${wasLoss ? "po ztrátě" : ""}: ${signal.symbol} čekej ${((cooldownMs - elapsed) / 1000).toFixed(0)}s` };
    }
  }

  return { allowed: true };
}

/**
 * Fee-aware Expected Value filtr
 * Spočítá jestli se trade matematicky vyplatí po odečtení poplatků
 * EV = (confidence × tpPercent) - ((1 - confidence) × slPercent) - feePercent
 */
const ROUND_TRIP_FEE_PERCENT = 0.07; // 0.02% maker + 0.05% taker (Binance Futures base tier)

export function isTradeWorthIt(
  confidence: number,
  slPercent: number,
  tpPercent: number
): { worthIt: boolean; expectedValue: number } {
  const expectedValue = (confidence * tpPercent) - ((1 - confidence) * slPercent) - ROUND_TRIP_FEE_PERCENT;
  return { worthIt: expectedValue > 0, expectedValue };
}

/**
 * Vypočítá SL/TP ceny na základě procent
 */
export function calculateSLTP(
  signal: Signal,
  instrumentConfig: InstrumentConfig,
  atr?: number
): { sl: number; tp: number } {
  const { price } = signal;
  const isBuy = signal.type === "BUY";

  // Pokud máme ATR, použij dynamický SL/TP (R:R = 1:1.67)
  if (atr && atr > 0) {
    const slDistance = atr * 1.2;
    const tpDistance = atr * 2.0;
    return {
      sl: isBuy ? price - slDistance : price + slDistance,
      tp: isBuy ? price + tpDistance : price - tpDistance,
    };
  }

  // Fallback na procentuální SL/TP
  const slDistance = price * (instrumentConfig.slPercent / 100);
  const tpDistance = price * (instrumentConfig.tpPercent / 100);

  return {
    sl: isBuy ? price - slDistance : price + slDistance,
    tp: isBuy ? price + tpDistance : price - tpDistance,
  };
}

export function shouldResetDaily(lastResetTimestamp: number): boolean {
  const now = new Date();
  const lastReset = new Date(lastResetTimestamp);
  return now.toDateString() !== lastReset.toDateString();
}

// ============================================================
// Trailing Stop & Breakeven logika
// ============================================================

export interface TrailingState {
  symbol: string;
  direction: "BUY" | "SELL";
  highWaterMark: number; // nejvyšší zisk od otevření
  breakevenActivated: boolean; // SL posunut na breakeven
  trailingActivated: boolean; // trailing stop aktivován
  currentTrailingStop: number; // aktuální trailing SL cena
}

/**
 * Vypočítá nový trailing stop na základě aktuální ceny
 * - Breakeven: pokud zisk > 0.2%, posuň SL na entry cenu
 * - Trailing: pokud zisk > 0.3%, posuň SL o trailingPercent pod high water mark
 */
export function calculateTrailingStop(
  state: TrailingState,
  currentPrice: number,
  entryPrice: number,
  trailingPercent: number = 0.2
): TrailingState {
  const updated = { ...state };

  const pnlPercent = state.direction === "BUY"
    ? ((currentPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - currentPrice) / entryPrice) * 100;

  // Update high water mark
  if (state.direction === "BUY") {
    updated.highWaterMark = Math.max(state.highWaterMark, currentPrice);
  } else {
    updated.highWaterMark = state.highWaterMark === 0
      ? currentPrice
      : Math.min(state.highWaterMark, currentPrice);
  }

  // Breakeven: pokud zisk > 0.2%, posuň SL na entry + malý buffer
  if (pnlPercent > 0.2 && !state.breakevenActivated) {
    updated.breakevenActivated = true;
    const buffer = entryPrice * 0.02 / 100; // 0.02% buffer
    updated.currentTrailingStop = state.direction === "BUY"
      ? entryPrice + buffer
      : entryPrice - buffer;
  }

  // Trailing: pokud zisk > 0.3%, trailing stop sleduje cenu
  if (pnlPercent > 0.3) {
    updated.trailingActivated = true;
    const trailDistance = updated.highWaterMark * (trailingPercent / 100);

    const newTrailingStop = state.direction === "BUY"
      ? updated.highWaterMark - trailDistance
      : updated.highWaterMark + trailDistance;

    // Trailing stop se může jen posouvat ve směru profitu
    if (state.direction === "BUY") {
      updated.currentTrailingStop = Math.max(updated.currentTrailingStop, newTrailingStop);
    } else {
      updated.currentTrailingStop = updated.currentTrailingStop === 0
        ? newTrailingStop
        : Math.min(updated.currentTrailingStop, newTrailingStop);
    }
  }

  return updated;
}

/**
 * Zkontroluje, zda trailing stop byl zasažen
 */
export function isTrailingStopHit(state: TrailingState, currentPrice: number): boolean {
  if (!state.breakevenActivated && !state.trailingActivated) return false;
  if (state.currentTrailingStop === 0) return false;

  if (state.direction === "BUY") {
    return currentPrice <= state.currentTrailingStop;
  } else {
    return currentPrice >= state.currentTrailingStop;
  }
}
