// ============================================================
// GET /api/conversations/counts — per-status conversation counts for
// the inbox tab badges (Ativos / Pendentes / Fechados). Deliberately
// separate from GET /api/conversations so the badge numbers reflect
// the account's totals, not whatever search/department filter the
// list happens to be scoped to right now.
//
// Mirrors the same visibility rule as GET /api/conversations: a
// plain agent/viewer's Ativos/Fechados counts are their own only;
// Pendentes always counts the whole shared queue.
// ============================================================

import { NextResponse } from "next/server";
import { and, count, eq } from "drizzle-orm";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { conversations } from "@/db/schema";
import { roleHasFullAccess } from "@/lib/auth/permissions";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const scoped = !roleHasFullAccess(ctx.role);

    const rows = await ctx.db
      .select({ status: conversations.status, value: count() })
      .from(conversations)
      .where(eq(conversations.accountId, ctx.accountId))
      .groupBy(conversations.status);

    const mineRows = scoped
      ? await ctx.db
          .select({ status: conversations.status, value: count() })
          .from(conversations)
          .where(
            and(
              eq(conversations.accountId, ctx.accountId),
              eq(conversations.assignedAgentId, ctx.userId),
            ),
          )
          .groupBy(conversations.status)
      : rows;

    const totals = { open: 0, pending: 0, closed: 0 };
    for (const row of rows) totals[row.status] = row.value;
    const mine = { open: 0, pending: 0, closed: 0 };
    for (const row of mineRows) mine[row.status] = row.value;

    const counts = scoped
      ? { open: mine.open, pending: totals.pending, closed: mine.closed }
      : totals;

    return NextResponse.json({ counts });
  } catch (err) {
    return toErrorResponse(err);
  }
}
