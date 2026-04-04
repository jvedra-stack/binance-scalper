// ============================================================
// Telegram notifikace a reporty
// ============================================================

import type { Trade } from "@/types";

const TELEGRAM_API = "https://api.telegram.org/bot";

interface TelegramConfig {
  botToken: string;
  chatId: string;
}

function getConfig(): TelegramConfig | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return null;
  return { botToken, chatId };
}

/**
 * Odešle zprávu přes Telegram Bot API
 */
async function sendMessage(text: string, parseMode: "HTML" | "Markdown" = "HTML"): Promise<boolean> {
  const config = getConfig();
  if (!config) return false;

  try {
    const res = await fetch(`${TELEGRAM_API}${config.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        parse_mode: parseMode,
      }),
    });
    return res.ok;
  } catch {
    console.error("[TELEGRAM] Chyba odesílání zprávy");
    return false;
  }
}

/**
 * Notifikace při otevření pozice
 */
export async function notifyTradeOpen(trade: Trade): Promise<void> {
  const emoji = trade.direction === "BUY" ? "🟢" : "🔴";
  const text = [
    `${emoji} <b>${trade.direction} ${trade.symbol}</b>`,
    `Cena: <code>${trade.openPrice.toFixed(2)}</code>`,
    `Volume: <code>${trade.volume}</code>`,
    `SL: <code>${trade.sl.toFixed(2)}</code> | TP: <code>${trade.tp.toFixed(2)}</code>`,
    `Confidence: <code>${(trade.signal.confidence * 100).toFixed(0)}%</code>`,
    ``,
    trade.signal.reasons.slice(0, 5).map((r) => `• ${r}`).join("\n"),
  ].join("\n");

  await sendMessage(text);
}

/**
 * Notifikace při zavření pozice
 */
export async function notifyTradeClose(trade: Trade): Promise<void> {
  const profit = trade.profit || 0;
  const emoji = profit >= 0 ? "✅" : "❌";
  const pnlEmoji = profit >= 0 ? "+" : "";

  const text = [
    `${emoji} <b>ZAVŘENO ${trade.symbol} ${trade.direction}</b>`,
    `P&L: <code>${pnlEmoji}${profit.toFixed(2)} USDT</code>`,
    `Entry: <code>${trade.openPrice.toFixed(2)}</code> → Exit: <code>${(trade.closePrice || 0).toFixed(2)}</code>`,
  ].join("\n");

  await sendMessage(text);
}

/**
 * Denní report
 */
export async function sendDailyReport(
  trades: Trade[],
  pnl: number,
  balance?: number
): Promise<void> {
  const closedTrades = trades.filter((t) => t.status === "closed");
  const wins = closedTrades.filter((t) => (t.profit || 0) > 0).length;
  const losses = closedTrades.length - wins;
  const winRate = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0;

  const emoji = pnl >= 0 ? "📈" : "📉";
  const pnlEmoji = pnl >= 0 ? "+" : "";

  const text = [
    `${emoji} <b>Denní report</b>`,
    ``,
    `P&L: <code>${pnlEmoji}${pnl.toFixed(2)} USDT</code>`,
    `Obchody: <code>${closedTrades.length}</code> (${wins}W / ${losses}L)`,
    `Win Rate: <code>${winRate.toFixed(1)}%</code>`,
    balance ? `Balance: <code>${balance.toFixed(2)} USDT</code>` : "",
    ``,
    `Top obchody:`,
    ...closedTrades
      .sort((a, b) => Math.abs(b.profit || 0) - Math.abs(a.profit || 0))
      .slice(0, 5)
      .map((t) => {
        const p = t.profit || 0;
        return `${p >= 0 ? "✅" : "❌"} ${t.symbol} ${t.direction}: ${p >= 0 ? "+" : ""}${p.toFixed(2)}`;
      }),
  ].filter(Boolean).join("\n");

  await sendMessage(text);
}

/**
 * Kill switch notifikace
 */
export async function notifyKillSwitch(pnl: number): Promise<void> {
  const text = [
    `🚨 <b>KILL SWITCH AKTIVOVÁN</b>`,
    ``,
    `Denní ztráta dosáhla limitu: <code>${pnl.toFixed(2)} USDT</code>`,
    `Všechny pozice zavřeny. Trading pozastaven.`,
  ].join("\n");

  await sendMessage(text);
}

/**
 * Kontrola, zda je Telegram nakonfigurovaný
 */
export function isTelegramConfigured(): boolean {
  return getConfig() !== null;
}
