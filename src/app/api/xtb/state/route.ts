import { NextResponse } from "next/server";
import { getEngineState, getEngineConfig, getAllTrades } from "@/lib/bybit/connection";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getEngineConfig();
  return NextResponse.json({
    state: getEngineState(),
    config: getEngineConfig(),
    trades: getAllTrades(),
    hasServerCredentials: !!(config.credentials.apiKey && config.credentials.apiSecret),
  });
}
