import { NextRequest, NextResponse } from "next/server";
import { startEngine, updateConfig } from "@/lib/bybit/connection";
import type { BotConfig } from "@/types";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const config: BotConfig = await req.json();
    updateConfig(config);
    await startEngine(config);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Neznámá chyba" },
      { status: 500 }
    );
  }
}
