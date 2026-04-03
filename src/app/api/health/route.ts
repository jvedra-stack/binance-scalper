import { NextResponse } from "next/server";
import { getEngineState } from "@/lib/bybit/connection";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = getEngineState();
  return NextResponse.json({
    status: "ok",
    bot: state.status,
    openPositions: state.openPositions.length,
    todayPnL: state.todayPnL,
    uptime: state.connectedAt ? Date.now() - state.connectedAt : 0,
  });
}
