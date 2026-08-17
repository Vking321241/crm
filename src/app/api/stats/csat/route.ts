import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { loadCsatStats } from "@/lib/dashboard/queries";

// GET /api/stats/csat?rangeDays=30 — satisfaction-survey (1-5)
// aggregate for the Estatísticas page: average, distribution, and
// per-agent breakdown.
export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const rangeDays = Number(new URL(request.url).searchParams.get("rangeDays")) || 30;

    const stats = await loadCsatStats(ctx.db, ctx.accountId, rangeDays);

    return NextResponse.json(stats);
  } catch (err) {
    return toErrorResponse(err);
  }
}
