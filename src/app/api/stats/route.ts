import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import {
  loadAgentBreakdown,
  loadContactsGrowth,
  loadConversationsSeries,
  loadConversationStatusBreakdown,
  loadMetrics,
  loadResponseTime,
} from "@/lib/dashboard/queries";

// GET /api/stats?rangeDays=30 — aggregated payload for the
// Estatísticas page: contacts growth, conversation status/handling
// time, messages in/out over time, response time, per-agent load.
export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const rangeDays = Number(new URL(request.url).searchParams.get("rangeDays")) || 30;

    const [metrics, contactsGrowth, conversationsSeries, statusBreakdown, responseTime, agents] =
      await Promise.all([
        loadMetrics(ctx.db, ctx.accountId),
        loadContactsGrowth(ctx.db, ctx.accountId, rangeDays),
        loadConversationsSeries(ctx.db, ctx.accountId, rangeDays),
        loadConversationStatusBreakdown(ctx.db, ctx.accountId),
        loadResponseTime(ctx.db, ctx.accountId),
        loadAgentBreakdown(ctx.db, ctx.accountId),
      ]);

    return NextResponse.json({
      metrics,
      contactsGrowth,
      conversationsSeries,
      statusBreakdown,
      responseTime,
      agents,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
