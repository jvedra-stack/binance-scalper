// ============================================================
// Binance Futures API klient – SERVER SIDE
// REST API + WebSocket streaming
// ============================================================

import crypto from "crypto";
import WebSocket from "ws";
import type {
  BybitCredentials as Credentials,
  BybitTicker as Ticker,
  BybitKline as Kline,
  BybitPosition as Position,
  BybitInstrumentInfo as InstrumentInfo,
} from "@/types";

type TickerHandler = (ticker: Ticker) => void;
type KlineHandler = (kline: Kline) => void;

const MAINNET_REST = "https://fapi.binance.com";
const TESTNET_REST = "https://testnet.binancefuture.com";
const MAINNET_WS = "wss://fstream.binance.com/ws";
const TESTNET_WS = "wss://stream.binancefuture.com/ws";

export class BybitClient {
  private credentials: Credentials;
  private restUrl: string;
  private ws: WebSocket | null = null;
  private tickerHandlers = new Map<string, TickerHandler[]>();
  private klineHandlers = new Map<string, KlineHandler[]>();
  private onDisconnect?: () => void;
  private pingInterval?: ReturnType<typeof setInterval>;
  private subscriptions: string[] = [];

  constructor(credentials: Credentials) {
    this.credentials = credentials;
    this.restUrl = credentials.testnet ? TESTNET_REST : MAINNET_REST;
  }

  // --- Auth ---

  private sign(queryString: string): string {
    return crypto
      .createHmac("sha256", this.credentials.apiSecret)
      .update(queryString)
      .digest("hex");
  }

  private async request<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    params: Record<string, string | number> = {},
    authenticated = false
  ): Promise<T> {
    const url = new URL(`${this.restUrl}${path}`);
    const headers: Record<string, string> = {};

    if (authenticated) {
      params.timestamp = Date.now().toString();
      params.recvWindow = "5000";
      const qs = new URLSearchParams(
        Object.entries(params).map(([k, v]) => [k, String(v)])
      ).toString();
      const signature = this.sign(qs);
      const fullQs = `${qs}&signature=${signature}`;

      if (method === "GET" || method === "DELETE") {
        url.search = fullQs;
      }
      headers["X-MBX-APIKEY"] = this.credentials.apiKey;
    } else if (method === "GET") {
      url.search = new URLSearchParams(
        Object.entries(params).map(([k, v]) => [k, String(v)])
      ).toString();
    }

    const body = method === "POST" && authenticated
      ? (() => {
          params.timestamp = params.timestamp || Date.now().toString();
          params.recvWindow = "5000";
          const qs = new URLSearchParams(
            Object.entries(params).map(([k, v]) => [k, String(v)])
          ).toString();
          const signature = this.sign(qs);
          return `${qs}&signature=${signature}`;
        })()
      : undefined;

    const res = await fetch(url.toString(), {
      method,
      headers: {
        ...headers,
        ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body,
    });

    const data = await res.json();
    if (data.code && data.code !== 200) {
      throw new Error(`Binance API error: ${data.msg} (${data.code})`);
    }
    return data as T;
  }

  // --- WebSocket ---

  async connectPublicWs(): Promise<void> {
    const wsUrl = this.credentials.testnet ? TESTNET_WS : MAINNET_WS;
    this.ws = new WebSocket(wsUrl);

    await new Promise<void>((resolve, reject) => {
      this.ws!.on("open", () => resolve());
      this.ws!.on("error", (e) => reject(new Error(`WS error: ${e.message}`)));
    });

    this.ws.on("message", (raw) => {
      try {
        const data = JSON.parse(raw.toString());

        // Mini ticker
        if (data.e === "24hrMiniTicker") {
          const symbol = data.s;
          const ticker: Ticker = {
            symbol,
            lastPrice: parseFloat(data.c),
            bid1Price: parseFloat(data.c), // mini ticker nemá bid/ask, použij last
            bid1Size: 0,
            ask1Price: parseFloat(data.c),
            ask1Size: 0,
            highPrice24h: parseFloat(data.h),
            lowPrice24h: parseFloat(data.l),
            volume24h: parseFloat(data.v),
            turnover24h: parseFloat(data.q),
            price24hPcnt: 0,
            timestamp: data.E,
          };
          const handlers = this.tickerHandlers.get(symbol) || [];
          handlers.forEach((h) => h(ticker));
        }

        // BookTicker (bid/ask)
        if (data.e === "bookTicker") {
          const symbol = data.s;
          const existing = this.tickerHandlers.get(symbol);
          if (existing) {
            const ticker: Ticker = {
              symbol,
              lastPrice: (parseFloat(data.b) + parseFloat(data.a)) / 2,
              bid1Price: parseFloat(data.b),
              bid1Size: parseFloat(data.B),
              ask1Price: parseFloat(data.a),
              ask1Size: parseFloat(data.A),
              highPrice24h: 0,
              lowPrice24h: 0,
              volume24h: 0,
              turnover24h: 0,
              price24hPcnt: 0,
              timestamp: Date.now(),
            };
            existing.forEach((h) => h(ticker));
          }
        }

        // Kline
        if (data.e === "kline" && data.k) {
          const k = data.k;
          const symbol = k.s;
          const interval = k.i; // "1m", "5m", "15m", etc.
          const kline: Kline = {
            start: k.t,
            end: k.T,
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
            turnover: parseFloat(k.q),
            symbol,
          };
          const key = `${symbol}:${interval}`;
          const handlers = this.klineHandlers.get(key) || [];
          handlers.forEach((h) => h(kline));
        }
      } catch {
        // ignoruj
      }
    });

    this.ws.on("close", () => {
      this.onDisconnect?.();
    });

    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.pong();
      }
    }, 20000);
  }

  // Binance nepotřebuje private WS pro obchody (REST stačí)
  async connectPrivateWs(): Promise<void> {
    // no-op, Binance futures používá REST pro ordery
  }

  // --- REST API ---

  async getInstruments(): Promise<{ list: InstrumentInfo[] }> {
    const data = await this.request<{ symbols: Array<Record<string, unknown>> }>("GET", "/fapi/v1/exchangeInfo");
    const list = data.symbols
      .filter((s) => s.status === "TRADING" && s.contractType === "PERPETUAL")
      .map((s) => {
        const lotFilter = (s.filters as Array<Record<string, string>>)?.find((f) => f.filterType === "LOT_SIZE") || {};
        const priceFilter = (s.filters as Array<Record<string, string>>)?.find((f) => f.filterType === "PRICE_FILTER") || {};
        return {
          symbol: s.symbol as string,
          baseCoin: s.baseAsset as string,
          quoteCoin: s.quoteAsset as string,
          status: s.status as string,
          lotSizeFilter: {
            minOrderQty: lotFilter.minQty || "0.001",
            maxOrderQty: lotFilter.maxQty || "1000",
            qtyStep: lotFilter.stepSize || "0.001",
          },
          priceFilter: {
            minPrice: priceFilter.minPrice || "0.01",
            maxPrice: priceFilter.maxPrice || "999999",
            tickSize: priceFilter.tickSize || "0.01",
          },
          leverageFilter: { minLeverage: "1", maxLeverage: "125", leverageStep: "1" },
        };
      });
    return { list };
  }

  async getKlines(symbol: string, interval: string = "1m", limit = 200): Promise<{ list: string[][] }> {
    const data = await this.request<string[][]>("GET", "/fapi/v1/klines", {
      symbol,
      interval: interval === "1" ? "1m" : interval,
      limit,
    });
    return { list: data };
  }

  async getTicker(symbol: string): Promise<{ list: Array<Record<string, string>> }> {
    const data = await this.request<Record<string, string>>("GET", "/fapi/v1/ticker/24hr", { symbol });
    return { list: [data] };
  }

  async getTickers(): Promise<{ list: Array<Record<string, string>> }> {
    const data = await this.request<Array<Record<string, string>>>("GET", "/fapi/v1/ticker/24hr");
    return { list: data };
  }

  async getBalance(): Promise<{ list: Array<{ totalEquity: string; totalAvailableBalance: string; coin: Array<{ coin: string; equity: string; availableToWithdraw: string }> }> }> {
    const data = await this.request<Array<{ asset: string; balance: string; availableBalance: string }> >("GET", "/fapi/v2/balance", {}, true);
    const usdtBalance = data.find((b) => b.asset === "USDC") || data.find((b) => b.asset === "USDT");
    const totalEquity = usdtBalance ? usdtBalance.balance : "0";
    const available = usdtBalance ? usdtBalance.availableBalance : "0";
    return {
      list: [{
        totalEquity,
        totalAvailableBalance: available,
        coin: data.map((b) => ({ coin: b.asset, equity: b.balance, availableToWithdraw: b.availableBalance })),
      }],
    };
  }

  async getPositions(symbol?: string): Promise<{ list: Array<{ symbol: string; side: "Buy" | "Sell"; size: string; avgPrice: string; liqPrice: string; takeProfit: string; stopLoss: string; unrealisedPnl: string; cumRealisedPnl: string; positionIdx: number; leverage: string }> }> {
    const params: Record<string, string | number> = {};
    if (symbol) params.symbol = symbol;
    const data = await this.request<Array<Record<string, string>>>("GET", "/fapi/v2/positionRisk", params, true);
    const list = data
      .filter((p) => parseFloat(p.positionAmt) !== 0)
      .map((p) => ({
        symbol: p.symbol,
        side: parseFloat(p.positionAmt) > 0 ? "Buy" as const : "Sell" as const,
        size: Math.abs(parseFloat(p.positionAmt)).toString(),
        avgPrice: p.entryPrice,
        liqPrice: p.liquidationPrice,
        takeProfit: "0",
        stopLoss: "0",
        unrealisedPnl: p.unRealizedProfit,
        cumRealisedPnl: "0",
        positionIdx: 0,
        leverage: p.leverage,
      }));
    return { list };
  }

  async placeOrder(params: {
    symbol: string;
    side: "Buy" | "Sell";
    orderType: "Market" | "Limit";
    qty: string;
    price?: string;
    stopLoss?: string;
    takeProfit?: string;
  }): Promise<{ orderId: string; orderLinkId: string; slPlaced: boolean; tpPlaced: boolean }> {
    const orderParams: Record<string, string | number> = {
      symbol: params.symbol,
      side: params.side === "Buy" ? "BUY" : "SELL",
      type: params.orderType === "Market" ? "MARKET" : "LIMIT",
      quantity: params.qty,
    };
    if (params.price && params.orderType === "Limit") {
      orderParams.price = params.price;
      orderParams.timeInForce = "GTC";
    }

    const data = await this.request<{ orderId: number; clientOrderId: string }>("POST", "/fapi/v1/order", orderParams, true);

    let slPlaced = false;
    let tpPlaced = false;
    const closeSide = params.side === "Buy" ? "SELL" : "BUY";

    // Stop Loss — closePosition=true (NESMÍ být quantity!), MARK_PRICE pro stabilní triggery
    if (params.stopLoss && parseFloat(params.stopLoss) > 0) {
      try {
        await this.request("POST", "/fapi/v1/order", {
          symbol: params.symbol,
          side: closeSide,
          type: "STOP_MARKET",
          stopPrice: params.stopLoss,
          closePosition: "true",
          workingType: "MARK_PRICE",
          priceProtect: "true",
          timeInForce: "GTE_GTC",
        }, true);
        slPlaced = true;
      } catch (err) {
        console.error(`[SL ORDER FAIL] ${params.symbol}: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Take Profit
    if (params.takeProfit && parseFloat(params.takeProfit) > 0) {
      try {
        await this.request("POST", "/fapi/v1/order", {
          symbol: params.symbol,
          side: closeSide,
          type: "TAKE_PROFIT_MARKET",
          stopPrice: params.takeProfit,
          closePosition: "true",
          workingType: "MARK_PRICE",
          priceProtect: "true",
          timeInForce: "GTE_GTC",
        }, true);
        tpPlaced = true;
      } catch (err) {
        console.error(`[TP ORDER FAIL] ${params.symbol}: ${err instanceof Error ? err.message : err}`);
      }
    }

    return { orderId: data.orderId.toString(), orderLinkId: data.clientOrderId, slPlaced, tpPlaced };
  }

  // Zruší všechny otevřené ordery na symbolu (cleanup před opening nové pozice)
  async cancelAllOrders(symbol: string): Promise<void> {
    try {
      await this.request("DELETE", "/fapi/v1/allOpenOrders", { symbol }, true);
    } catch { /* ok */ }
  }

  async closePosition(symbol: string, side: "Buy" | "Sell", qty: string): Promise<{ orderId: string }> {
    const closeSide = side === "Buy" ? "Sell" : "Buy";
    const result = await this.placeOrder({
      symbol,
      side: closeSide,
      orderType: "Market",
      qty,
    });
    return { orderId: result.orderId };
  }

  async setLeverage(symbol: string, leverage: string): Promise<void> {
    await this.request("POST", "/fapi/v1/leverage", {
      symbol,
      leverage: parseInt(leverage),
    }, true);
  }

  // --- Funding Rate ---

  async getFundingRate(symbol: string): Promise<{ fundingRate: string; fundingTime: number; markPrice: string }> {
    const data = await this.request<{ fundingRate: string; fundingTime: number; markPrice: string }>(
      "GET", "/fapi/v1/premiumIndex", { symbol }
    );
    return data;
  }

  async getAllFundingRates(): Promise<Array<{ symbol: string; fundingRate: string; fundingTime: number; markPrice: string }>> {
    const data = await this.request<Array<{ symbol: string; fundingRate: string; fundingTime: number; markPrice: string }>>(
      "GET", "/fapi/v1/premiumIndex"
    );
    return data;
  }

  // --- Streaming subscriptions ---

  subscribeTicker(symbol: string, handler: TickerHandler): void {
    if (!this.tickerHandlers.has(symbol)) {
      this.tickerHandlers.set(symbol, []);
      const stream = `${symbol.toLowerCase()}@bookTicker`;
      this.subscriptions.push(stream);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          method: "SUBSCRIBE",
          params: [stream],
          id: Date.now(),
        }));
      }
    }
    this.tickerHandlers.get(symbol)!.push(handler);
  }

  subscribeKline(symbol: string, interval: string, handler: KlineHandler): void {
    const key = `${symbol}:${interval === "1" ? "1m" : interval}`;
    if (!this.klineHandlers.has(key)) {
      this.klineHandlers.set(key, []);
      const stream = `${symbol.toLowerCase()}@kline_${interval === "1" ? "1m" : interval}`;
      this.subscriptions.push(stream);
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          method: "SUBSCRIBE",
          params: [stream],
          id: Date.now(),
        }));
      }
    }
    this.klineHandlers.get(key)!.push(handler);
  }

  // --- Lifecycle ---

  setDisconnectHandler(handler: () => void): void {
    this.onDisconnect = handler;
  }

  disconnect(): void {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.ws?.close();
    this.ws = null;
    this.tickerHandlers.clear();
    this.klineHandlers.clear();
    this.subscriptions = [];
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
