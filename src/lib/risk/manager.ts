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

  // 3. Max denních tradů
  if (todayTrades.length >= config.maxDailyTrades) {
    return { allowed: false, reason: `Max denních tradů (${config.maxDailyTrades}) dosažen` };
  }

  // 4. Žádný duplicitní trade na stejném symbolu stejným směrem
  const duplicit = openPositions.find(
    (t) => t.symbol === signal.symbol && t.direction === signal.type
  );
  if (duplicit) {
    return { allowed: false, reason: `Již existuje otevřená ${signal.type} pozice na ${signal.symbol}` };
  }

  // 5. Cooldown 30s od posledního zavřeného tradu
  const lastClosed = todayTrades
    .filter((t) => t.symbol === signal.symbol && t.status === "closed")
    .sort((a, b) => (b.closeTime || 0) - (a.closeTime || 0))[0];

  if (lastClosed && lastClosed.closeTime) {
    const elapsed = Date.now() - lastClosed.closeTime;
    if (elapsed < 30000) {
      return { allowed: false, reason: `Cooldown: poslední trade na ${signal.symbol} zavřen před ${(elapsed / 1000).toFixed(0)}s` };
    }
  }

  return { allowed: true };
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

  // Pokud máme ATR, použij dynamický SL/TP
  if (atr && atr > 0) {
    const slDistance = atr * 1.5;
    const tpDistance = atr * 1.0;
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
