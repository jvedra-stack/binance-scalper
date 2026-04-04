// ============================================================
// Korelace mezi kryptoměnami
// Pearson korelace pro filtrování duplicitních pozic
// ============================================================

import type { BybitKline } from "@/types";

export interface CorrelationPair {
  symbolA: string;
  symbolB: string;
  correlation: number; // -1 to 1
}

export interface CorrelationMatrix {
  symbols: string[];
  matrix: number[][]; // [i][j] = korelace mezi symbols[i] a symbols[j]
  pairs: CorrelationPair[];
  timestamp: number;
}

/**
 * Pearson korelační koeficient mezi dvěma řadami cen
 * @returns -1 (protisměrná) až +1 (souběžná)
 */
export function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 10) return 0;

  // Použij returns (% změny) místo absolutních cen
  const xReturns: number[] = [];
  const yReturns: number[] = [];
  for (let i = 1; i < n; i++) {
    if (x[i - 1] === 0 || y[i - 1] === 0) continue;
    xReturns.push((x[i] - x[i - 1]) / x[i - 1]);
    yReturns.push((y[i] - y[i - 1]) / y[i - 1]);
  }

  const len = xReturns.length;
  if (len < 5) return 0;

  const xMean = xReturns.reduce((a, b) => a + b, 0) / len;
  const yMean = yReturns.reduce((a, b) => a + b, 0) / len;

  let numerator = 0;
  let xDenominator = 0;
  let yDenominator = 0;

  for (let i = 0; i < len; i++) {
    const xDiff = xReturns[i] - xMean;
    const yDiff = yReturns[i] - yMean;
    numerator += xDiff * yDiff;
    xDenominator += xDiff * xDiff;
    yDenominator += yDiff * yDiff;
  }

  const denominator = Math.sqrt(xDenominator * yDenominator);
  if (denominator === 0) return 0;

  return numerator / denominator;
}

/**
 * Spočítá korelační matici pro všechny páry symbolů
 */
export function computeCorrelationMatrix(
  candleBuffers: Map<string, BybitKline[]>,
  symbols: string[]
): CorrelationMatrix {
  const n = symbols.length;
  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  const pairs: CorrelationPair[] = [];

  // Extrahuj close ceny pro každý symbol
  const closePrices = new Map<string, number[]>();
  for (const symbol of symbols) {
    const klines = candleBuffers.get(symbol);
    if (klines && klines.length >= 20) {
      closePrices.set(symbol, klines.map((k) => k.close));
    }
  }

  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1; // Autokorelace = 1
    const pricesA = closePrices.get(symbols[i]);
    if (!pricesA) continue;

    for (let j = i + 1; j < n; j++) {
      const pricesB = closePrices.get(symbols[j]);
      if (!pricesB) continue;

      const corr = pearsonCorrelation(pricesA, pricesB);
      matrix[i][j] = corr;
      matrix[j][i] = corr;

      pairs.push({
        symbolA: symbols[i],
        symbolB: symbols[j],
        correlation: corr,
      });
    }
  }

  return {
    symbols,
    matrix,
    pairs: pairs.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation)),
    timestamp: Date.now(),
  };
}

/**
 * Zkontroluje, zda by nová pozice kolidovala s existující
 * kvůli vysoké korelaci
 * @returns { allowed, reason }
 */
export function checkCorrelationRisk(
  newSymbol: string,
  newDirection: "BUY" | "SELL",
  openPositions: Array<{ symbol: string; direction: string }>,
  correlationMatrix: CorrelationMatrix,
  threshold: number = 0.7
): { allowed: boolean; reason?: string } {
  const symbolIdx = correlationMatrix.symbols.indexOf(newSymbol);
  if (symbolIdx === -1) return { allowed: true };

  for (const pos of openPositions) {
    const posIdx = correlationMatrix.symbols.indexOf(pos.symbol);
    if (posIdx === -1 || posIdx === symbolIdx) continue;

    const corr = correlationMatrix.matrix[symbolIdx][posIdx];

    // Vysoká pozitivní korelace + stejný směr = duplicitní expozice
    if (corr > threshold && pos.direction === newDirection) {
      return {
        allowed: false,
        reason: `Korelace ${newSymbol}↔${pos.symbol}: ${(corr * 100).toFixed(0)}% — duplicitní ${newDirection} expozice`,
      };
    }

    // Vysoká pozitivní korelace + opačný směr = hedged (povoleno, ale s varováním)
    // Vysoká negativní korelace + stejný směr = duplicitní expozice
    if (corr < -threshold && pos.direction !== newDirection) {
      return {
        allowed: false,
        reason: `Neg. korelace ${newSymbol}↔${pos.symbol}: ${(corr * 100).toFixed(0)}% — duplicitní expozice (protisměrné coiny)`,
      };
    }
  }

  return { allowed: true };
}
