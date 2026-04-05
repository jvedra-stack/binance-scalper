// ============================================================
// Technické indikátory pro scalping
// Čistě matematické funkce, žádné side-effecty
// ============================================================

/**
 * EMA – Exponential Moving Average
 * Rychlejší reakce na cenové změny než SMA
 */
export function ema(prices: number[], period: number): number[] {
  if (prices.length < period) return [];

  const k = 2 / (period + 1);
  const result: number[] = [];

  // Prvních `period` hodnot = SMA
  let sum = 0;
  for (let i = 0; i < period; i++) sum += prices[i];
  result.push(sum / period);

  // Zbytek = EMA
  for (let i = period; i < prices.length; i++) {
    result.push(prices[i] * k + result[result.length - 1] * (1 - k));
  }

  return result;
}

/**
 * SMA – Simple Moving Average
 */
export function sma(prices: number[], period: number): number[] {
  if (prices.length < period) return [];
  const result: number[] = [];
  for (let i = period - 1; i < prices.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += prices[j];
    result.push(sum / period);
  }
  return result;
}

/**
 * RSI – Relative Strength Index
 * < 30 = přeprodáno (buy signál), > 70 = překoupeno (sell signál)
 */
export function rsi(prices: number[], period: number = 14): number[] {
  if (prices.length < period + 1) return [];

  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  const result: number[] = [];
  let avgGain = 0;
  let avgLoss = 0;

  // Počáteční průměry
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  if (avgLoss === 0) {
    result.push(100);
  } else {
    const rs = avgGain / avgLoss;
    result.push(100 - 100 / (1 + rs));
  }

  // Zbytek – Wilder smoothing
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) {
      result.push(100);
    } else {
      const rs = avgGain / avgLoss;
      result.push(100 - 100 / (1 + rs));
    }
  }

  return result;
}

/**
 * Bollinger Bands
 * Cena u horního pásma = překoupeno, u dolního = přeprodáno
 */
export function bollingerBands(
  prices: number[],
  period: number = 20,
  stdDevMultiplier: number = 2
): { upper: number[]; middle: number[]; lower: number[] } {
  const middle = sma(prices, period);
  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < middle.length; i++) {
    const slice = prices.slice(i, i + period);
    const mean = middle[i];
    const variance = slice.reduce((sum, p) => sum + (p - mean) ** 2, 0) / period;
    const stdDev = Math.sqrt(variance);
    upper.push(mean + stdDevMultiplier * stdDev);
    lower.push(mean - stdDevMultiplier * stdDev);
  }

  return { upper, middle, lower };
}

/**
 * ATR – Average True Range
 * Měří volatilitu – používáme pro dynamický stop-loss
 */
export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): number[] {
  if (highs.length < period + 1) return [];

  const trueRanges: number[] = [];

  // Prvni TR je jen high - low
  trueRanges.push(highs[0] - lows[0]);

  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trueRanges.push(tr);
  }

  // ATR = EMA true range
  const result: number[] = [];
  let sum = 0;
  for (let i = 0; i < period; i++) sum += trueRanges[i];
  result.push(sum / period);

  for (let i = period; i < trueRanges.length; i++) {
    result.push((result[result.length - 1] * (period - 1) + trueRanges[i]) / period);
  }

  return result;
}

/**
 * VWAP – Volume Weighted Average Price (zjednodušená verze)
 * Používá se jako support/resistance level
 */
export function vwap(
  prices: number[],
  volumes: number[]
): number[] {
  const result: number[] = [];
  let cumPV = 0;
  let cumV = 0;

  for (let i = 0; i < prices.length; i++) {
    cumPV += prices[i] * (volumes[i] || 1);
    cumV += volumes[i] || 1;
    result.push(cumPV / cumV);
  }

  return result;
}

/**
 * ADX – Average Directional Index
 * Měří sílu trendu (ne směr). ADX > 25 = silný trend, < 20 = ranging/choppy
 */
export function adx(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): number[] {
  if (highs.length < period * 2 + 1) return [];

  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const trueRanges: number[] = [];

  for (let i = 1; i < highs.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];

    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);

    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trueRanges.push(tr);
  }

  // Wilder smoothing pro ATR, +DM, -DM
  const smooth = (arr: number[], p: number): number[] => {
    const result: number[] = [];
    let sum = 0;
    for (let i = 0; i < p; i++) sum += arr[i];
    result.push(sum);
    for (let i = p; i < arr.length; i++) {
      result.push(result[result.length - 1] - result[result.length - 1] / p + arr[i]);
    }
    return result;
  };

  const smoothTR = smooth(trueRanges, period);
  const smoothPlusDM = smooth(plusDM, period);
  const smoothMinusDM = smooth(minusDM, period);

  // +DI a -DI
  const dx: number[] = [];
  for (let i = 0; i < smoothTR.length; i++) {
    if (smoothTR[i] === 0) { dx.push(0); continue; }
    const plusDI = (smoothPlusDM[i] / smoothTR[i]) * 100;
    const minusDI = (smoothMinusDM[i] / smoothTR[i]) * 100;
    const diSum = plusDI + minusDI;
    dx.push(diSum === 0 ? 0 : (Math.abs(plusDI - minusDI) / diSum) * 100);
  }

  // ADX = smoothed DX
  if (dx.length < period) return [];
  const result: number[] = [];
  let adxSum = 0;
  for (let i = 0; i < period; i++) adxSum += dx[i];
  result.push(adxSum / period);
  for (let i = period; i < dx.length; i++) {
    result.push((result[result.length - 1] * (period - 1) + dx[i]) / period);
  }

  return result;
}

/**
 * Stochastic RSI – přesnější signály než samotné RSI
 * Měří pozici RSI v jeho vlastním rozsahu
 */
export function stochRsi(prices: number[], rsiPeriod: number = 14, stochPeriod: number = 14): number[] {
  const rsiValues = rsi(prices, rsiPeriod);
  if (rsiValues.length < stochPeriod) return [];

  const result: number[] = [];

  for (let i = stochPeriod - 1; i < rsiValues.length; i++) {
    const slice = rsiValues.slice(i - stochPeriod + 1, i + 1);
    const min = Math.min(...slice);
    const max = Math.max(...slice);
    if (max === min) {
      result.push(50);
    } else {
      result.push(((rsiValues[i] - min) / (max - min)) * 100);
    }
  }

  return result;
}
