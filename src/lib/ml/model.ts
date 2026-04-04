// ============================================================
// Machine Learning modul – učení z vlastních tradů
// Logistická regrese na feature vektorech z indikátorů
// ============================================================

import type { IndicatorValues, Trade } from "@/types";
import { loadServerData, saveServerData } from "@/lib/server-store";

// Feature vektor extrahovaný z indikátorů v momentě otevření tradu
export interface TradeFeatures {
  // Normalizované indikátory
  rsi: number; // 0-100
  emaCrossover: number; // emaFast - emaSlow (normalizované)
  bbPosition: number; // pozice ceny v BB (0-1)
  atrPercent: number; // ATR jako % ceny
  volumeRatio: number; // volume vs průměr
  confidence: number; // originální confidence signálu
  direction: number; // 1 = BUY, -1 = SELL
  // Výsledek
  won: boolean;
}

// Logistická regrese - jednoduché váhy pro predikci
export interface MLModel {
  weights: number[]; // váhy pro každou feature
  bias: number;
  trainedOn: number; // počet tradů na kterých je natrénovaný
  accuracy: number; // přesnost na trénovacích datech
  lastTrained: number;
}

const ML_DATA_KEY = "ml_features";
const ML_MODEL_KEY = "ml_model";

// Sigmoid funkce
function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/**
 * Extrahuje feature vektor z trade signálu
 */
export function extractFeatures(
  indicators: IndicatorValues,
  price: number,
  confidence: number,
  direction: "BUY" | "SELL"
): Omit<TradeFeatures, "won"> {
  const bbWidth = indicators.bbUpper - indicators.bbLower;
  const bbPosition = bbWidth > 0
    ? (price - indicators.bbLower) / bbWidth
    : 0.5;

  const emaCrossover = price > 0
    ? ((indicators.emaFast - indicators.emaSlow) / price) * 1000
    : 0;

  const atrPercent = price > 0 ? (indicators.atr / price) * 100 : 0;

  return {
    rsi: indicators.rsi / 100, // normalizováno na 0-1
    emaCrossover,
    bbPosition,
    atrPercent,
    volumeRatio: 1, // bude doplněno z candle dat
    confidence,
    direction: direction === "BUY" ? 1 : -1,
  };
}

/**
 * Zaloguje feature vektor dokončeného tradu
 */
export function logTradeFeatures(features: TradeFeatures): void {
  const data = loadMLFeatures();
  data.push(features);
  // Uchovej max 500 posledních
  if (data.length > 500) data.splice(0, data.length - 500);
  saveServerData(ML_DATA_KEY, data);
}

/**
 * Načti nalogované features
 */
export function loadMLFeatures(): TradeFeatures[] {
  return loadServerData<TradeFeatures[]>(ML_DATA_KEY) || [];
}

/**
 * Natrénuje model na nalogovaných datech
 * Jednoduchá logistická regrese s gradient descentem
 */
export function trainModel(): MLModel | null {
  const features = loadMLFeatures();
  if (features.length < 20) return null; // potřebujeme alespoň 20 tradů

  const featureNames = ["rsi", "emaCrossover", "bbPosition", "atrPercent", "volumeRatio", "confidence", "direction"] as const;
  const numFeatures = featureNames.length;

  // Inicializace vah
  let weights = new Array(numFeatures).fill(0);
  let bias = 0;
  const learningRate = 0.01;
  const epochs = 100;

  // Trénování
  for (let epoch = 0; epoch < epochs; epoch++) {
    for (const sample of features) {
      const x = featureNames.map((f) => sample[f]);
      const y = sample.won ? 1 : 0;

      // Forward pass
      let z = bias;
      for (let i = 0; i < numFeatures; i++) {
        z += weights[i] * x[i];
      }
      const prediction = sigmoid(z);
      const error = prediction - y;

      // Gradient descent
      bias -= learningRate * error;
      for (let i = 0; i < numFeatures; i++) {
        weights[i] -= learningRate * error * x[i];
      }
    }
  }

  // Evaluace
  let correct = 0;
  for (const sample of features) {
    const x = featureNames.map((f) => sample[f]);
    let z = bias;
    for (let i = 0; i < numFeatures; i++) {
      z += weights[i] * x[i];
    }
    const predicted = sigmoid(z) >= 0.5;
    if (predicted === sample.won) correct++;
  }

  const model: MLModel = {
    weights,
    bias,
    trainedOn: features.length,
    accuracy: correct / features.length,
    lastTrained: Date.now(),
  };

  saveServerData(ML_MODEL_KEY, model);
  console.log(`[ML] Model natrénován na ${features.length} tradech, přesnost: ${(model.accuracy * 100).toFixed(1)}%`);
  return model;
}

/**
 * Predikuje pravděpodobnost výhry pro daný trade
 * @returns 0-1 pravděpodobnost výhry, nebo null pokud model neexistuje
 */
export function predictWinProbability(
  indicators: IndicatorValues,
  price: number,
  confidence: number,
  direction: "BUY" | "SELL"
): number | null {
  const model = loadServerData<MLModel>(ML_MODEL_KEY);
  if (!model || model.trainedOn < 20) return null;

  const features = extractFeatures(indicators, price, confidence, direction);
  const featureNames = ["rsi", "emaCrossover", "bbPosition", "atrPercent", "volumeRatio", "confidence", "direction"] as const;

  let z = model.bias;
  for (let i = 0; i < model.weights.length; i++) {
    z += model.weights[i] * features[featureNames[i]];
  }

  return sigmoid(z);
}

/**
 * Načte uložený model
 */
export function loadModel(): MLModel | null {
  return loadServerData<MLModel>(ML_MODEL_KEY);
}
