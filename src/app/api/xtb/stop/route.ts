import { NextResponse } from "next/server";
import { stopEngine } from "@/lib/bybit/connection";

export const dynamic = "force-dynamic";

export async function POST() {
  stopEngine();
  return NextResponse.json({ ok: true });
}
