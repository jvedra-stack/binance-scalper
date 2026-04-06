// ============================================================
// Bybit Scalper – datový model
// ============================================================

// --- Bybit API typy ---

export interface BybitCredentials {
  apiKey: string;
  apiSecret: string;
  testnet: boolean; // true = testnet, false = mainnet
}

export interface BybitTicker {
  symbol: string;
  lastPrice: number;
  bid1Price: number;
  bid1Size: number;
  ask1Price: number;
  ask1Size: number;
  highPrice24h: number;
  lowPrice24h: number;
  volume24h: number;
  turnover24h: number;
  price24hPcnt: number;
  timestamp: number;
}

export interface BybitKline {
  start: number;
  end: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
  symbol?: string;
}

export interface BybitPosition {
  symbol: string;
  side: "Buy" | "Sell";
  size: string;
  avgPrice: string;
  liqPrice: string;
  takeProfit: string;
  stopLoss: string;
  unrealisedPnl: string;
  cumRealisedPnl: string;
  positionIdx: number;
  leverage: string;
}

export interface BybitOrder {
  orderId: string;
  symbol: string;
  side: "Buy" | "Sell";
  orderType: string;
  price: string;
  qty: string;
  orderStatus: string;
  avgPrice: string;
  cumExecQty: string;
  cumExecValue: string;
  createdTime: string;
  updatedTime: string;
}

export interface BybitInstrumentInfo {
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  status: string;
  lotSizeFilter: {
    minOrderQty: string;
    maxOrderQty: string;
    qtyStep: string;
  };
  priceFilter: {
    minPrice: string;
    maxPrice: string;
    tickSize: string;
  };
  leverageFilter: {
    minLeverage: string;
    maxLeverage: string;
    leverageStep: string;
  };
}

// --- Indikátory ---

export interface IndicatorValues {
  emaFast: number;
  emaSlow: number;
  rsi: number;
  bbUpper: number;
  bbMiddle: number;
  bbLower: number;
  atr: number;
  volume: number;
  stochRsi: number;
  timestamp: number;
}

// --- Signály ---

export type SignalType = "BUY" | "SELL" | "HOLD";

export interface Signal {
  type: SignalType;
  symbol: string;
  price: number;
  timestamp: number;
  confidence: number; // 0-1
  reasons: string[];
  indicators: IndicatorValues;
  blocked?: string; // důvod proč se trade neexekuoval (pro UI)
}

// --- Obchody ---

export type TradeStatus = "open" | "closed" | "cancelled";

export interface Trade {
  id: string;
  orderId?: string;
  symbol: string;
  direction: "BUY" | "SELL";
  volume: number;
  openPrice: number;
  closePrice?: number;
  openTime: number;
  closeTime?: number;
  sl: number;
  tp: number;
  profit?: number;
  status: TradeStatus;
  signal: Signal;
}

// --- Konfigurace ---

export interface InstrumentConfig {
  symbol: string;
  label: string;
  enabled: boolean;
  volume: number; // velikost pozice v USDT nebo v coinu
  slPercent: number; // stop-loss v %
  tpPercent: number; // take-profit v %
}

export interface StrategyConfig {
  emaFastPeriod: number;
  emaSlowPeriod: number;
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;
  bbPeriod: number;
  bbStdDev: number;
  atrPeriod: number;
  minConfidence: number;
}

export interface RiskConfig {
  maxOpenPositions: number;
  maxDailyLoss: number; // v USDT
  trailingStop: boolean;
  trailingStopPercent: number;
}

export interface BotConfig {
  credentials: BybitCredentials;
  instruments: InstrumentConfig[];
  strategy: StrategyConfig;
  risk: RiskConfig;
  active: boolean;
}

// --- Engine stav ---

export type EngineStatus = "stopped" | "connecting" | "running" | "error" | "killed";

export interface EngineState {
  status: EngineStatus;
  connectedAt?: number;
  lastTick?: Record<string, BybitTicker>;
  openPositions: Trade[];
  todayTrades: Trade[];
  todayPnL: number;
  error?: string;
  signals: Signal[];
  balance?: number;
}

// --- Defaultní konfigurace ---

export const DEFAULT_INSTRUMENTS: InstrumentConfig[] = [
  { symbol: "BTCUSDT", label: "Bitcoin", enabled: true, volume: 3000, slPercent: 0.4, tpPercent: 0.8 },
  { symbol: "ETHUSDT", label: "Ethereum", enabled: true, volume: 3000, slPercent: 0.4, tpPercent: 0.8 },
  { symbol: "SOLUSDT", label: "Solana", enabled: true, volume: 3000, slPercent: 0.5, tpPercent: 0.9 },
  { symbol: "DOGEUSDT", label: "Doge", enabled: false, volume: 1000, slPercent: 0.5, tpPercent: 0.9 },
  { symbol: "PEPEUSDT", label: "Pepe", enabled: false, volume: 1000, slPercent: 0.6, tpPercent: 1.0 },
  { symbol: "XRPUSDT", label: "XRP", enabled: false, volume: 1000, slPercent: 0.4, tpPercent: 0.8 },
  { symbol: "AVAXUSDT", label: "Avalanche", enabled: false, volume: 1000, slPercent: 0.5, tpPercent: 0.9 },
  { symbol: "SUIUSDT", label: "Sui", enabled: false, volume: 1000, slPercent: 0.5, tpPercent: 0.9 },
];

export const DEFAULT_STRATEGY: StrategyConfig = {
  emaFastPeriod: 9,
  emaSlowPeriod: 21,
  rsiPeriod: 14,
  rsiOverbought: 70,
  rsiOversold: 30,
  bbPeriod: 20,
  bbStdDev: 2,
  atrPeriod: 14,
  minConfidence: 0.65,
};

export const DEFAULT_RISK: RiskConfig = {
  maxOpenPositions: 6,
  maxDailyLoss: 100, // USDT
  trailingStop: true,
  trailingStopPercent: 0.2,
};

export const DEFAULT_CONFIG: BotConfig = {
  credentials: { apiKey: "", apiSecret: "", testnet: true },
  instruments: DEFAULT_INSTRUMENTS,
  strategy: DEFAULT_STRATEGY,
  risk: DEFAULT_RISK,
  active: false,
};
