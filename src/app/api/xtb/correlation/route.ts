import { NextResponse } from "next/server";
import { getCorrelationMatrix } from "@/lib/bybit/connection";

export const dynamic = "force-dynamic";

export async function GET() {
  const matrix = getCorrelationMatrix();
  if (!matrix) {
    return NextResponse.json({ ok: false, error: "Bot neběží nebo nedostatek dat" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, correlation: matrix });
}
