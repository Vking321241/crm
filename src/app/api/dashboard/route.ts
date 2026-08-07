import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import {
  loadActivity,
  loadConversationsSeries,
  loadMetrics,
  loadPipelineDonut,
  loadResponseTime,
} from "@/lib/dashboard/queries";

// GET /api/dashboard?rangeDays=14 — single aggregated payload for the
// dashboard page. Replaces five parallel client-side Supabase calls
// (RLS scoped them automatically; here `ctx.accountId` does that job
// explicitly inside each query in src/lib/dashboard/queries.ts).
export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const rangeDays = Number(new URL(request.url).searchParams.get("rangeDays")) || 14;

    const [metrics, conversationsSeries, pipelineDonut, responseTime, activity] =
      await Promise.all([
        loadMetrics(ctx.db, ctx.accountId),
        loadConversationsSeries(ctx.db, ctx.accountId, rangeDays),
        loadPipelineDonut(ctx.db, ctx.accountId),
        loadResponseTime(ctx.db, ctx.accountId),
        loadActivity(ctx.db, ctx.accountId),
      ]);

    return NextResponse.json({ metrics, conversationsSeries, pipelineDonut, responseTime, activity });
  } catch (err) {
    return toErrorResponse(err);
  }
}
