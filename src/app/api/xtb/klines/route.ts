import { NextRequest, NextResponse } from "next/server";
import { getClient } from "@/lib/bybit/connection";

export const dynamic = "force-dynamic";

// GET /api/xtb/klines?symbol=BTCUSDT&interval=1m&limit=200
// Vrací historické svíčky pro graf
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const symbol = searchParams.get("symbol") || "BTCUSDT";
  const interval = searchParams.get("interval") || "1m";
  const limit = parseInt(searchParams.get("limit") || "200");

  const client = getClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: "Bot neběží" }, { status: 400 });
  }

  try {
    const result = await client.getKlines(symbol, interval, Math.min(limit, 1500));
    const klines = (result.list || []).map((k: string[]) => ({
      time: Math.floor(parseInt(k[0]) / 1000), // lightweight-charts chce sekundy
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    })).reverse(); // Binance vrací od nejnovější, chart chce od nejstarší

    return NextResponse.json({ ok: true, klines });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Chyba" },
      { status: 500 }
    );
  }
}
