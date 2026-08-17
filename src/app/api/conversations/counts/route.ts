// ============================================================
// GET /api/conversations/counts — per-status conversation counts for
// the inbox tab badges (Ativos / Pendentes / Fechados). Deliberately
// separate from GET /api/conversations so the badge numbers reflect
// the account's totals, not whatever search/department filter the
// list happens to be scoped to right now.
// ============================================================

import { NextResponse } from "next/server";
import { count, eq } from "drizzle-orm";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { conversations } from "@/db/schema";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const rows = await ctx.db
      .select({ status: conversations.status, value: count() })
      .from(conversations)
      .where(eq(conversations.accountId, ctx.accountId))
      .groupBy(conversations.status);

    const counts = { open: 0, pending: 0, closed: 0 };
    for (const row of rows) {
      counts[row.status] = row.value;
    }

    return NextResponse.json({ counts });
  } catch (err) {
    return toErrorResponse(err);
  }
}
