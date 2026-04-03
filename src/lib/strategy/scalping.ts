// ============================================================
// Scalping strategie – multi-indikátor scoring systém
// ============================================================

import type {
  Signal,
  SignalType,
  IndicatorValues,
  StrategyConfig,
} from "@/types";

// Generický candle záznam (kompatibilní s XTB i Bybit)
interface CandleRecord {
  close: number;
  high: number;
  low: number;
  open: number;
  vol: number;
  ctm: number;
  ctmString: string;
}
import { ema, rsi, bollingerBands, atr } from "./indicators";

interface CandleData {
  closes: number[];
  highs: number[];
  lows: number[];
  volumes: number[];
}

/**
 * Extrahuje cenová data z XTB candle záznamů
 */
function extractData(candles: CandleRecord[]): CandleData {
  return {
    closes: candles.map((c) => c.close),
    highs: candles.map((c) => c.high),
    lows: candles.map((c) => c.low),
    volumes: candles.map((c) => c.vol),
  };
}

/**
 * Vypočítá aktuální hodnoty indikátorů
 */
export function computeIndicators(
  candles: CandleRecord[],
  config: StrategyConfig
): IndicatorValues | null {
  if (candles.length < Math.max(config.emaSlowPeriod, config.bbPeriod, config.atrPeriod) + 5) {
    return null; // nedostatek dat
  }

  const { closes, highs, lows, volumes } = extractData(candles);

  const emaFastArr = ema(closes, config.emaFastPeriod);
  const emaSlowArr = ema(closes, config.emaSlowPeriod);
  const rsiArr = rsi(closes, config.rsiPeriod);
  const bb = bollingerBands(closes, config.bbPeriod, config.bbStdDev);
  const atrArr = atr(highs, lows, closes, config.atrPeriod);

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
    timestamp: Date.now(),
  };
}

/**
 * Generuje trading signál na základě multi-indikátor scoring systému
 *
 * Každý indikátor přidává body BUY nebo SELL:
 * - EMA crossover: +0.3
 * - RSI extrém: +0.25
 * - Bollinger Band touch: +0.25
 * - ATR filtr (volatilita): +0.1
 * - Volume konfirmace: +0.1
 *
 * Celková confidence = součet bodů (max 1.0)
 * Pozice se otevírá jen pokud confidence >= minConfidence
 */
export function generateSignal(
  symbol: string,
  candles: CandleRecord[],
  currentPrice: number,
  config: StrategyConfig
): Signal {
  const indicators = computeIndicators(candles, config);

  if (!indicators) {
    return {
      type: "HOLD",
      symbol,
      price: currentPrice,
      timestamp: Date.now(),
      confidence: 0,
      reasons: ["Nedostatek dat pro výpočet indikátorů"],
      indicators: {
        emaFast: 0, emaSlow: 0, rsi: 50,
        bbUpper: 0, bbMiddle: 0, bbLower: 0,
        atr: 0, volume: 0, timestamp: Date.now(),
      },
    };
  }

  let buyScore = 0;
  let sellScore = 0;
  const reasons: string[] = [];

  // 1. EMA Crossover (0.3)
  if (indicators.emaFast > indicators.emaSlow) {
    buyScore += 0.3;
    reasons.push(`EMA${config.emaFastPeriod} > EMA${config.emaSlowPeriod} (bullish)`);
  } else if (indicators.emaFast < indicators.emaSlow) {
    sellScore += 0.3;
    reasons.push(`EMA${config.emaFastPeriod} < EMA${config.emaSlowPeriod} (bearish)`);
  }

  // 2. EMA trend direction – extra body za trend momentum
  const { closes } = extractData(candles);
  const emaFastPrev = ema(closes.slice(0, -1), config.emaFastPeriod);
  if (emaFastPrev.length > 0) {
    const prevEmaFast = emaFastPrev[emaFastPrev.length - 1];
    if (indicators.emaFast > prevEmaFast) {
      buyScore += 0.1;
      reasons.push("EMA fast roste (momentum up)");
    } else if (indicators.emaFast < prevEmaFast) {
      sellScore += 0.1;
      reasons.push("EMA fast klesá (momentum down)");
    }
  }

  // 3. RSI (0.25)
  if (indicators.rsi < config.rsiOversold) {
    buyScore += 0.25;
    reasons.push(`RSI ${indicators.rsi.toFixed(1)} < ${config.rsiOversold} (přeprodáno)`);
  } else if (indicators.rsi > config.rsiOverbought) {
    sellScore += 0.25;
    reasons.push(`RSI ${indicators.rsi.toFixed(1)} > ${config.rsiOverbought} (překoupeno)`);
  } else if (indicators.rsi < 45) {
    buyScore += 0.1;
    reasons.push(`RSI ${indicators.rsi.toFixed(1)} mírně nízké`);
  } else if (indicators.rsi > 55) {
    sellScore += 0.1;
    reasons.push(`RSI ${indicators.rsi.toFixed(1)} mírně vysoké`);
  }

  // 4. Bollinger Bands (0.25)
  if (currentPrice <= indicators.bbLower) {
    buyScore += 0.25;
    reasons.push(`Cena na dolním BB (${indicators.bbLower.toFixed(2)})`);
  } else if (currentPrice >= indicators.bbUpper) {
    sellScore += 0.25;
    reasons.push(`Cena na horním BB (${indicators.bbUpper.toFixed(2)})`);
  } else if (currentPrice < indicators.bbMiddle) {
    buyScore += 0.1;
    reasons.push("Cena pod BB středem");
  } else {
    sellScore += 0.1;
    reasons.push("Cena nad BB středem");
  }

  // 5. ATR filtr – trade jen při dostatečné volatilitě (0.1)
  const avgPrice = closes.reduce((a, b) => a + b, 0) / closes.length;
  const atrPercent = (indicators.atr / avgPrice) * 100;
  if (atrPercent > 0.1) {
    // Volatilita OK, přidej body k dominantní straně
    if (buyScore > sellScore) buyScore += 0.1;
    else if (sellScore > buyScore) sellScore += 0.1;
    reasons.push(`ATR ${atrPercent.toFixed(3)}% – volatilita OK`);
  } else {
    reasons.push(`ATR ${atrPercent.toFixed(3)}% – nízká volatilita`);
  }

  // Vyhodnocení
  let type: SignalType = "HOLD";
  let confidence = 0;

  if (buyScore > sellScore && buyScore >= config.minConfidence) {
    type = "BUY";
    confidence = Math.min(buyScore, 1);
  } else if (sellScore > buyScore && sellScore >= config.minConfidence) {
    type = "SELL";
    confidence = Math.min(sellScore, 1);
  } else {
    confidence = Math.max(buyScore, sellScore);
    reasons.push(`Nedostatečná confidence (buy: ${buyScore.toFixed(2)}, sell: ${sellScore.toFixed(2)})`);
  }

  return {
    type,
    symbol,
    price: currentPrice,
    timestamp: Date.now(),
    confidence,
    reasons,
    indicators,
  };
}
