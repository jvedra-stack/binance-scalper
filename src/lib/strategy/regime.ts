// ============================================================
// Market Regime Detection
// Určuje stav trhu: TRENDING, RANGING, nebo CHAOTIC
// Bot by neměl obchodovat v CHAOTIC režimu
// ============================================================

import { adx, atr, ema } from "./indicators";

export type MarketRegime = "TRENDING" | "RANGING" | "CHAOTIC";

interface CandleRecord {
  close: number;
  high: number;
  low: number;
  open: number;
  vol: number;
  ctm: number;
  ctmString: string;
}

/**
 * Detekuje režim trhu na základě ADX, ATR a EMA trendu.
 *
 * - TRENDING: ADX > 25 → silný trend, použij trendové strategie
 * - RANGING: ADX < 20, normální volatilita → použij mean reversion
 * - CHAOTIC: ADX < 20 + ATR > 2× průměr → nepředvídatelný trh, neobchoduj
 */
export function detectRegime(candles: CandleRecord[]): { regime: MarketRegime; adxValue: number; reason: string } {
  if (candles.length < 50) {
    return { regime: "RANGING", adxValue: 0, reason: "Nedostatek dat pro regime detection" };
  }

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  // ADX — síla trendu
  const adxValues = adx(highs, lows, closes, 14);
  const currentADX = adxValues.length > 0 ? adxValues[adxValues.length - 1] : 0;

  // ATR — volatilita
  const atrValues = atr(highs, lows, closes, 14);
  if (atrValues.length < 20) {
    return { regime: "RANGING", adxValue: currentADX, reason: "Nedostatek ATR dat" };
  }

  const currentATR = atrValues[atrValues.length - 1];
  const avgATR = atrValues.slice(-20).reduce((a, b) => a + b, 0) / 20;

  // EMA trend confirmation
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const hasEmaTrend = ema20.length > 0 && ema50.length > 0 &&
    Math.abs(ema20[ema20.length - 1] - ema50[ema50.length - 1]) / ema50[ema50.length - 1] > 0.001;

  // CHAOTIC: nízký ADX + vysoká volatilita = nepředvídatelný trh
  if (currentADX < 20 && currentATR > avgATR * 2) {
    return {
      regime: "CHAOTIC",
      adxValue: currentADX,
      reason: `Chaotic: ADX ${currentADX.toFixed(1)} (slabý trend) + ATR ${(currentATR / avgATR * 100).toFixed(0)}% průměru (extrémní volatilita)`,
    };
  }

  // TRENDING: silný ADX
  if (currentADX > 25 && hasEmaTrend) {
    return {
      regime: "TRENDING",
      adxValue: currentADX,
      reason: `Trending: ADX ${currentADX.toFixed(1)} (silný trend) + EMA20/50 divergence`,
    };
  }

  // TRENDING: mírný ADX ale jasný EMA trend
  if (currentADX > 20 && hasEmaTrend) {
    return {
      regime: "TRENDING",
      adxValue: currentADX,
      reason: `Trending (mírný): ADX ${currentADX.toFixed(1)} + EMA trend`,
    };
  }

  // RANGING: nízký ADX, normální volatilita
  return {
    regime: "RANGING",
    adxValue: currentADX,
    reason: `Ranging: ADX ${currentADX.toFixed(1)} (bez trendu), normální volatilita`,
  };
}
