import { NextResponse } from "next/server";
import { getEngineState, getEngineConfig, getAllTrades } from "@/lib/bybit/connection";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    state: getEngineState(),
    config: getEngineConfig(),
    trades: getAllTrades(),
  });
}
