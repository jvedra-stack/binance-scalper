// ============================================================
// Multi-strategie scalping engine
// Strategie: EMA Scalp, Mean Reversion, Breakout, Momentum
// + Trend filtr + Dynamický position sizing
// ============================================================

import type {
  Signal,
  SignalType,
  IndicatorValues,
  StrategyConfig,
} from "@/types";

interface CandleRecord {
  close: number;
  high: number;
  low: number;
  open: number;
  vol: number;
  ctm: number;
  ctmString: string;
}

import { ema, rsi, bollingerBands, atr, stochRsi, vwap } from "./indicators";
import { detectRegime } from "./regime";

function extractData(candles: CandleRecord[]) {
  return {
    closes: candles.map((c) => c.close),
    highs: candles.map((c) => c.high),
    lows: candles.map((c) => c.low),
    volumes: candles.map((c) => c.vol),
  };
}

export function computeIndicators(
  candles: CandleRecord[],
  config: StrategyConfig
): IndicatorValues | null {
  if (candles.length < Math.max(config.emaSlowPeriod, config.bbPeriod, config.atrPeriod) + 5) {
    return null;
  }
  const { closes, highs, lows, volumes } = extractData(candles);
  const emaFastArr = ema(closes, config.emaFastPeriod);
  const emaSlowArr = ema(closes, config.emaSlowPeriod);
  const rsiArr = rsi(closes, config.rsiPeriod);
  const bb = bollingerBands(closes, config.bbPeriod, config.bbStdDev);
  const atrArr = atr(highs, lows, closes, config.atrPeriod);
  const stochRsiArr = stochRsi(closes, config.rsiPeriod, 14);
  const vwapArr = vwap(closes, volumes);

  if (!emaFastArr.length || !emaSlowArr.length || !rsiArr.length || !bb.upper.length || !atrArr.length) {
    return null;
  }
  return {
    emaFast: emaFastArr[emaFastArr.length - 1],
    emaSlow: emaSlowArr[emaSlowArr.length - 1],
    rsi: rsiArr[rsiArr.length - 1],
    bbUpper: bb.upper[bb.upper.length - 1],
    bbMiddle: bb.middle[bb.middle.length - 1],
    bbLower: bb.lower[bb.lower.length - 1],
    atr: atrArr[atrArr.length - 1],
    volume: volumes[volumes.length - 1],
    stochRsi: stochRsiArr.length > 0 ? stochRsiArr[stochRsiArr.length - 1] : 50,
    vwap: vwapArr.length > 0 ? vwapArr[vwapArr.length - 1] : 0,
    timestamp: Date.now(),
  };
}

// ============================================================
// TREND FILTR — používá EMA50 pro určení hlavního trendu
// Neobchoduj LONG pokud cena < EMA50, neobchoduj SHORT pokud cena > EMA50
// ============================================================
function getTrendDirection(closes: number[]): "UP" | "DOWN" | "NEUTRAL" {
  const ema50 = ema(closes, 50);
  if (ema50.length === 0) return "NEUTRAL";
  const currentEma50 = ema50[ema50.length - 1];
  const currentPrice = closes[closes.length - 1];
  const diff = ((currentPrice - currentEma50) / currentEma50) * 100;
  if (diff > 0.05) return "UP";
  if (diff < -0.05) return "DOWN";
  return "NEUTRAL";
}

// ============================================================
// STRATEGIE 1: EMA Scalp (původní, vylepšená)
// ============================================================
function emaScalpScore(indicators: IndicatorValues, config: StrategyConfig, closes: number[]): { buy: number; sell: number; reasons: string[] } {
  let buy = 0, sell = 0;
  const reasons: string[] = [];

  // EMA Crossover
  if (indicators.emaFast > indicators.emaSlow) {
    buy += 0.25;
    reasons.push(`EMA${config.emaFastPeriod} > EMA${config.emaSlowPeriod} (bullish)`);
  } else {
    sell += 0.25;
    reasons.push(`EMA${config.emaFastPeriod} < EMA${config.emaSlowPeriod} (bearish)`);
  }

  // EMA momentum
  const prevEmaFast = ema(closes.slice(0, -1), config.emaFastPeriod);
  if (prevEmaFast.length > 0) {
    if (indicators.emaFast > prevEmaFast[prevEmaFast.length - 1]) {
      buy += 0.1;
      reasons.push("EMA momentum UP");
    } else {
      sell += 0.1;
      reasons.push("EMA momentum DOWN");
    }
  }

  return { buy, sell, reasons };
}

// ============================================================
// STRATEGIE 2: Mean Reversion (návrat k průměru)
// Nakupuj když cena je příliš daleko od BB středu
// ============================================================
function meanReversionScore(indicators: IndicatorValues, currentPrice: number): { buy: number; sell: number; reasons: string[] } {
  let buy = 0, sell = 0;
  const reasons: string[] = [];

  const bbWidth = indicators.bbUpper - indicators.bbLower;
  const distFromLower = currentPrice - indicators.bbLower;
  const distFromUpper = indicators.bbUpper - currentPrice;
  const positionInBB = bbWidth > 0 ? distFromLower / bbWidth : 0.5;

  if (positionInBB < 0.1) {
    buy += 0.3;
    reasons.push(`Mean Rev: cena na ${(positionInBB * 100).toFixed(0)}% BB (extrémně nízko)`);
  } else if (positionInBB < 0.2) {
    buy += 0.2;
    reasons.push(`Mean Rev: cena na ${(positionInBB * 100).toFixed(0)}% BB (nízko)`);
  } else if (positionInBB > 0.9) {
    sell += 0.3;
    reasons.push(`Mean Rev: cena na ${(positionInBB * 100).toFixed(0)}% BB (extrémně vysoko)`);
  } else if (positionInBB > 0.8) {
    sell += 0.2;
    reasons.push(`Mean Rev: cena na ${(positionInBB * 100).toFixed(0)}% BB (vysoko)`);
  }

  return { buy, sell, reasons };
}

// ============================================================
// STRATEGIE 3: Breakout (průraz)
// Detekuje breakout z konsolidace
// ============================================================
function breakoutScore(candles: CandleRecord[], indicators: IndicatorValues, currentPrice: number): { buy: number; sell: number; reasons: string[] } {
  let buy = 0, sell = 0;
  const reasons: string[] = [];

  // Posledních 20 svíček — najdi high/low range
  const recent = candles.slice(-20);
  const rangeHigh = Math.max(...recent.map((c) => c.high));
  const rangeLow = Math.min(...recent.map((c) => c.low));
  const rangeSize = ((rangeHigh - rangeLow) / rangeLow) * 100;

  // Breakout = cena prorazí range s vysokým ATR
  if (rangeSize < 0.5) { // tight range = konsolidace
    if (currentPrice > rangeHigh) {
      buy += 0.3;
      reasons.push(`Breakout UP: proraz ${rangeHigh.toFixed(2)} (range ${rangeSize.toFixed(2)}%)`);
    } else if (currentPrice < rangeLow) {
      sell += 0.3;
      reasons.push(`Breakout DOWN: proraz ${rangeLow.toFixed(2)} (range ${rangeSize.toFixed(2)}%)`);
    }
  }

  return { buy, sell, reasons };
}

// ============================================================
// STRATEGIE 4: Momentum (síla pohybu)
// RSI + Stochastic + Volume
// ============================================================
function momentumScore(indicators: IndicatorValues, config: StrategyConfig, closes: number[], candles?: CandleRecord[]): { buy: number; sell: number; reasons: string[] } {
  let buy = 0, sell = 0;
  const reasons: string[] = [];

  // RSI extreme
  if (indicators.rsi < config.rsiOversold) {
    buy += 0.2;
    reasons.push(`RSI ${indicators.rsi.toFixed(1)} přeprodáno`);
  } else if (indicators.rsi > config.rsiOverbought) {
    sell += 0.2;
    reasons.push(`RSI ${indicators.rsi.toFixed(1)} překoupeno`);
  } else if (indicators.rsi < 40) {
    buy += 0.1;
    reasons.push(`RSI ${indicators.rsi.toFixed(1)} nízké`);
  } else if (indicators.rsi > 60) {
    sell += 0.1;
    reasons.push(`RSI ${indicators.rsi.toFixed(1)} vysoké`);
  }

  // Stochastic RSI — přesnější oversold/overbought signály
  if (indicators.stochRsi < 15) {
    buy += 0.2;
    reasons.push(`StochRSI ${indicators.stochRsi.toFixed(0)} extrémně přeprodáno`);
  } else if (indicators.stochRsi < 25) {
    buy += 0.1;
    reasons.push(`StochRSI ${indicators.stochRsi.toFixed(0)} přeprodáno`);
  } else if (indicators.stochRsi > 85) {
    sell += 0.2;
    reasons.push(`StochRSI ${indicators.stochRsi.toFixed(0)} extrémně překoupeno`);
  } else if (indicators.stochRsi > 75) {
    sell += 0.1;
    reasons.push(`StochRSI ${indicators.stochRsi.toFixed(0)} překoupeno`);
  }

  // Price momentum — posledních 5 svíček
  if (closes.length >= 5) {
    const recentChange = ((closes[closes.length - 1] - closes[closes.length - 5]) / closes[closes.length - 5]) * 100;
    if (recentChange > 0.3) {
      buy += 0.15;
      reasons.push(`Momentum +${recentChange.toFixed(2)}% (5 candles)`);
    } else if (recentChange < -0.3) {
      sell += 0.15;
      reasons.push(`Momentum ${recentChange.toFixed(2)}% (5 candles)`);
    }
  }

  // Volume spike
  if (candles && candles.length > 20) {
    const avgVol = candles.slice(-20).reduce((s, c) => s + c.vol, 0) / 20;
    if (avgVol > 0 && indicators.volume > avgVol * 1.5) {
      if (buy > sell) buy += 0.1;
      else if (sell > buy) sell += 0.1;
      reasons.push(`Volume spike ${(indicators.volume / avgVol).toFixed(1)}x`);
    }
  }

  return { buy, sell, reasons };
}

// ============================================================
// HLAVNÍ FUNKCE — kombinuje všechny strategie
// ============================================================
export function generateSignal(
  symbol: string,
  candles: CandleRecord[],
  currentPrice: number,
  config: StrategyConfig,
  mtfCandles?: Record<string, CandleRecord[]>
): Signal {
  const indicators = computeIndicators(candles, config);

  if (!indicators) {
    return {
      type: "HOLD", symbol, price: currentPrice, timestamp: Date.now(),
      confidence: 0, reasons: ["Nedostatek dat"],
      indicators: { emaFast: 0, emaSlow: 0, rsi: 50, bbUpper: 0, bbMiddle: 0, bbLower: 0, atr: 0, volume: 0, stochRsi: 50, vwap: 0, timestamp: Date.now() },
    };
  }

  const { closes } = extractData(candles);
  const reasons: string[] = [];
  let totalBuy = 0;
  let totalSell = 0;

  // Market Regime Detection — vyber strategie podle stavu trhu
  const { regime, reason: regimeReason } = detectRegime(candles);
  reasons.push(`Regime: ${regime} — ${regimeReason}`);

  // CHAOTIC → neobchoduj
  if (regime === "CHAOTIC") {
    return {
      type: "HOLD", symbol, price: currentPrice, timestamp: Date.now(),
      confidence: 0, reasons: [...reasons, "CHAOTIC režim → žádný obchod"],
      indicators,
    };
  }

  // Vyber strategie podle režimu
  const strats: Array<{ buy: number; sell: number; reasons: string[] }> = [];

  if (regime === "TRENDING") {
    // V trendu: EMA Scalp + Breakout + Momentum (ne Mean Reversion!)
    strats.push(emaScalpScore(indicators, config, closes));
    strats.push(breakoutScore(candles, indicators, currentPrice));
    strats.push(momentumScore(indicators, config, closes, candles));
  } else {
    // RANGING: Mean Reversion + Momentum (ne Breakout, ne EMA crossover!)
    strats.push(meanReversionScore(indicators, currentPrice));
    strats.push(momentumScore(indicators, config, closes, candles));
  }

  for (const s of strats) {
    totalBuy += s.buy;
    totalSell += s.sell;
    reasons.push(...s.reasons);
  }

  // Volume filtr — neobchoduj při nízkém volume
  if (candles.length >= 20) {
    const recentVols = candles.slice(-5).map((c) => c.vol);
    const avgVol20 = candles.slice(-20).reduce((s, c) => s + c.vol, 0) / 20;
    const recentAvgVol = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
    if (avgVol20 > 0 && recentAvgVol < avgVol20 * 0.5) {
      totalBuy *= 0.7;
      totalSell *= 0.7;
      reasons.push(`Low volume: ${(recentAvgVol / avgVol20 * 100).toFixed(0)}% průměru → confidence -30%`);
    }
  }

  // VWAP filtr — cena pod VWAP = kupuj (pod fair value), nad = prodávej
  if (indicators.vwap > 0) {
    if (currentPrice < indicators.vwap && totalBuy > totalSell) {
      totalBuy += 0.15;
      reasons.push(`VWAP: cena pod VWAP → buy posílen`);
    } else if (currentPrice > indicators.vwap && totalSell > totalBuy) {
      totalSell += 0.15;
      reasons.push(`VWAP: cena nad VWAP → sell posílen`);
    } else if (currentPrice > indicators.vwap && totalBuy > totalSell) {
      totalBuy *= 0.9;
      reasons.push(`VWAP: buy nad VWAP → oslaben`);
    } else if (currentPrice < indicators.vwap && totalSell > totalBuy) {
      totalSell *= 0.9;
      reasons.push(`VWAP: sell pod VWAP → oslaben`);
    }
  }

  // ATR volatilita bonus
  const avgPrice = closes.reduce((a, b) => a + b, 0) / closes.length;
  const atrPercent = (indicators.atr / avgPrice) * 100;
  if (atrPercent > 0.05) {
    if (totalBuy > totalSell) totalBuy += 0.1;
    else if (totalSell > totalBuy) totalSell += 0.1;
    reasons.push(`ATR ${atrPercent.toFixed(3)}% OK`);
  }

  // TREND FILTR — neobchoduj proti trendu
  const trend = getTrendDirection(closes);
  if (trend === "UP" && totalSell > totalBuy) {
    totalSell *= 0.5; // oslabí sell signál v uptrendu
    reasons.push("Trend filtr: uptrend → sell oslaben");
  } else if (trend === "DOWN" && totalBuy > totalSell) {
    totalBuy *= 0.5; // oslabí buy signál v downtrendu
    reasons.push("Trend filtr: downtrend → buy oslaben");
  } else if (trend !== "NEUTRAL") {
    reasons.push(`Trend: ${trend}`);
  }

  // MULTI-TIMEFRAME CONFLUENCE
  // Pokud máme data z vyšších timeframů, ověříme shodu trendu
  if (mtfCandles && Object.keys(mtfCandles).length > 0) {
    let mtfBullish = 0;
    let mtfBearish = 0;
    let mtfTotal = 0;

    for (const [tf, tfCandles] of Object.entries(mtfCandles)) {
      const tfCloses = tfCandles.map((c) => c.close);
      const tfTrend = getTrendDirection(tfCloses);
      mtfTotal++;
      if (tfTrend === "UP") {
        mtfBullish++;
        reasons.push(`MTF ${tf}: uptrend`);
      } else if (tfTrend === "DOWN") {
        mtfBearish++;
        reasons.push(`MTF ${tf}: downtrend`);
      } else {
        reasons.push(`MTF ${tf}: neutral`);
      }
    }

    // Shoda všech timeframů → confidence boost
    if (mtfTotal >= 2) {
      if (mtfBullish === mtfTotal && totalBuy > totalSell) {
        totalBuy += 0.15;
        reasons.push("MTF confluence: všechny TF bullish → +15% confidence");
      } else if (mtfBearish === mtfTotal && totalSell > totalBuy) {
        totalSell += 0.15;
        reasons.push("MTF confluence: všechny TF bearish → +15% confidence");
      } else if (mtfBullish === mtfTotal && totalSell > totalBuy) {
        totalSell *= 0.6; // proti MTF trendu → oslabení
        reasons.push("MTF filtr: sell proti bullish MTF → oslaben");
      } else if (mtfBearish === mtfTotal && totalBuy > totalSell) {
        totalBuy *= 0.6;
        reasons.push("MTF filtr: buy proti bearish MTF → oslaben");
      }
    }
  }

  // Vyhodnocení
  let type: SignalType = "HOLD";
  let confidence = 0;

  if (totalBuy > totalSell && totalBuy >= config.minConfidence) {
    type = "BUY";
    confidence = Math.min(totalBuy, 1);
  } else if (totalSell > totalBuy && totalSell >= config.minConfidence) {
    type = "SELL";
    confidence = Math.min(totalSell, 1);
  } else {
    confidence = Math.max(totalBuy, totalSell);
    reasons.push(`Confidence: buy ${totalBuy.toFixed(2)}, sell ${totalSell.toFixed(2)}`);
  }

  return { type, symbol, price: currentPrice, timestamp: Date.now(), confidence, reasons, indicators };
}

// ============================================================
// DYNAMICKÝ POSITION SIZING
// Po výhrách zvětšuj, po prohrách zmenšuj (anti-martingale)
// ============================================================
export function dynamicPositionSize(baseSize: number, recentTrades: Array<{ profit: number }>): number {
  if (recentTrades.length === 0) return baseSize;

  // Posledních 5 tradů
  const recent = recentTrades.slice(-5);
  const wins = recent.filter((t) => t.profit > 0).length;
  const winRate = wins / recent.length;

  // Win streak bonus
  let streak = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].profit > 0) streak++;
    else break;
  }

  // Lose streak penalty
  let loseStreak = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i].profit <= 0) loseStreak++;
    else break;
  }

  let multiplier = 1;
  if (streak >= 3) multiplier = 1.5; // 3+ výhry = +50%
  else if (streak >= 2) multiplier = 1.25; // 2 výhry = +25%
  else if (loseStreak >= 3) multiplier = 0.5; // 3+ prohry = -50%
  else if (loseStreak >= 2) multiplier = 0.75; // 2 prohry = -25%

  return Math.max(baseSize * 0.5, baseSize * multiplier); // minimum 50% base
}
