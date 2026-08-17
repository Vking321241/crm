// ============================================================
// GET /api/stats/advanced?from=&to=&departmentId=&agentId=
//
// Filtered analytics payload for the Dashboard Analytics e
// Relatórios screen: KPIs, heatmap, department pie, per-agent bar.
// `from`/`to` are ISO dates (day granularity); defaults to the last
// 7 days when omitted. Gated behind the "reports" permission module.
// ============================================================

import { NextResponse } from "next/server";

import { requireModule, toErrorResponse } from "@/lib/auth/account";
import { loadAdvancedAnalytics } from "@/lib/dashboard/queries";
import { daysAgoStart } from "@/lib/dashboard/date-utils";

export async function GET(request: Request) {
  try {
    const ctx = await requireModule("reports");
    const { searchParams } = new URL(request.url);

    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    const departmentId = searchParams.get("departmentId") || undefined;
    const agentId = searchParams.get("agentId") || undefined;

    const from = fromParam ? new Date(fromParam) : daysAgoStart(6);
    const to = toParam ? new Date(toParam) : new Date();
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return NextResponse.json({ error: "Invalid from/to date" }, { status: 400 });
    }
    // Inclusive end-of-day so "today" captures messages sent later today.
    to.setHours(23, 59, 59, 999);

    const analytics = await loadAdvancedAnalytics(ctx.db, ctx.accountId, {
      from,
      to,
      departmentId,
      agentId,
    });

    return NextResponse.json({ analytics });
  } catch (err) {
    return toErrorResponse(err);
  }
}
