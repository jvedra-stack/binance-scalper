// ============================================================
// Funding Rate modul
// Sledování funding rate pro arbitrážní signály
// ============================================================

export interface FundingRateData {
  symbol: string;
  fundingRate: number; // aktuální funding rate (kladná = longy platí, záporná = shorty platí)
  fundingTime: number; // čas dalšího funding
  markPrice: number;
  timestamp: number;
}

export interface FundingSignal {
  symbol: string;
  type: "FUNDING_SHORT" | "FUNDING_LONG" | "NEUTRAL";
  fundingRate: number;
  annualizedRate: number;
  reason: string;
  confidence: number; // 0-1
}

/**
 * Analyzuj funding rate a vygeneruj signál
 * - Extrémně pozitivní funding (>0.05%) → short bias (longy přeplácí)
 * - Extrémně negativní funding (<-0.05%) → long bias (shorty přeplácí)
 */
export function analyzeFundingRate(data: FundingRateData): FundingSignal {
  const rate = data.fundingRate;
  const annualized = rate * 3 * 365 * 100; // 3× denně × 365 dní × 100%

  // Extrémně pozitivní funding = přeplácené longy → short bias
  if (rate >= 0.001) { // 0.1%+
    return {
      symbol: data.symbol,
      type: "FUNDING_SHORT",
      fundingRate: rate,
      annualizedRate: annualized,
      reason: `Funding ${(rate * 100).toFixed(4)}% (${annualized.toFixed(0)}% p.a.) — extrémně pozitivní, short bias`,
      confidence: Math.min(0.7, Math.abs(rate) * 500),
    };
  }

  if (rate >= 0.0005) { // 0.05%+
    return {
      symbol: data.symbol,
      type: "FUNDING_SHORT",
      fundingRate: rate,
      annualizedRate: annualized,
      reason: `Funding ${(rate * 100).toFixed(4)}% (${annualized.toFixed(0)}% p.a.) — pozitivní, mírný short bias`,
      confidence: Math.min(0.4, Math.abs(rate) * 300),
    };
  }

  // Extrémně negativní funding = přeplácené shorty → long bias
  if (rate <= -0.001) {
    return {
      symbol: data.symbol,
      type: "FUNDING_LONG",
      fundingRate: rate,
      annualizedRate: annualized,
      reason: `Funding ${(rate * 100).toFixed(4)}% (${annualized.toFixed(0)}% p.a.) — extrémně negativní, long bias`,
      confidence: Math.min(0.7, Math.abs(rate) * 500),
    };
  }

  if (rate <= -0.0005) {
    return {
      symbol: data.symbol,
      type: "FUNDING_LONG",
      fundingRate: rate,
      annualizedRate: annualized,
      reason: `Funding ${(rate * 100).toFixed(4)}% (${annualized.toFixed(0)}% p.a.) — negativní, mírný long bias`,
      confidence: Math.min(0.4, Math.abs(rate) * 300),
    };
  }

  return {
    symbol: data.symbol,
    type: "NEUTRAL",
    fundingRate: rate,
    annualizedRate: annualized,
    reason: `Funding ${(rate * 100).toFixed(4)}% — neutrální`,
    confidence: 0,
  };
}
