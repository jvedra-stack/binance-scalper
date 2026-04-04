import { NextRequest, NextResponse } from "next/server";
import { closeSinglePosition } from "@/lib/bybit/connection";

export const dynamic = "force-dynamic";

// POST /api/xtb/close-position
// Body: { symbol: "BTCUSDT", direction: "BUY" | "SELL" }
export async function POST(req: NextRequest) {
  try {
    const { symbol, direction } = await req.json();
    if (!symbol || !direction) {
      return NextResponse.json({ ok: false, error: "Chybí symbol nebo direction" }, { status: 400 });
    }
    await closeSinglePosition(symbol, direction);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Chyba" },
      { status: 500 }
    );
  }
}
