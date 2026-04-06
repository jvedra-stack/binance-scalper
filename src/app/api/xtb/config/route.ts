import { NextRequest, NextResponse } from "next/server";
import { updateConfig, getEngineConfig } from "@/lib/bybit/connection";
import { saveServerConfig } from "@/lib/server-store";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getEngineConfig());
}

export async function POST(req: NextRequest) {
  const partial = await req.json();
  const updated = updateConfig(partial);
  saveServerConfig(updated);
  return NextResponse.json(updated);
}
