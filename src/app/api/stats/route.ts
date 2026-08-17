import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import {
  loadActivity,
  loadAgentBreakdown,
  loadContactsGrowth,
  loadConversationsSeries,
  loadConversationStatusBreakdown,
  loadMetrics,
  loadResponseTime,
} from "@/lib/dashboard/queries";

// GET /api/stats?rangeDays=30 — aggregated payload for the
// Estatísticas page: contacts growth, conversation status/handling
// time, messages in/out over time, response time, per-agent load,
// recent activity (the one thing the old Painel dashboard had that
// this page didn't — ported here when Painel/Pipeline/Negócios were
// removed since it's still useful "atendimento" info).
export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const rangeDays = Number(new URL(request.url).searchParams.get("rangeDays")) || 30;

    const [metrics, contactsGrowth, conversationsSeries, statusBreakdown, responseTime, agents, activity] =
      await Promise.all([
        loadMetrics(ctx.db, ctx.accountId),
        loadContactsGrowth(ctx.db, ctx.accountId, rangeDays),
        loadConversationsSeries(ctx.db, ctx.accountId, rangeDays),
        loadConversationStatusBreakdown(ctx.db, ctx.accountId),
        loadResponseTime(ctx.db, ctx.accountId),
        loadAgentBreakdown(ctx.db, ctx.accountId),
        loadActivity(ctx.db, ctx.accountId),
      ]);

    return NextResponse.json({
      metrics,
      contactsGrowth,
      conversationsSeries,
      statusBreakdown,
      responseTime,
      agents,
      activity,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
