import { NextResponse } from "next/server";
import { closeAllPositions } from "@/lib/bybit/connection";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await closeAllPositions();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Chyba" },
      { status: 500 }
    );
  }
}
