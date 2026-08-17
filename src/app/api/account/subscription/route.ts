// ============================================================
// GET /api/account/subscription — current Kiwify subscription state
// for the caller's account (admin+ can view).
// ============================================================

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { accounts } from "@/db/schema";

export async function GET() {
  try {
    const ctx = await requireRole("admin");

    const [row] = await ctx.db
      .select({
        plan: accounts.subscriptionPlan,
        status: accounts.subscriptionStatus,
        renewsAt: accounts.subscriptionRenewsAt,
        canceledAt: accounts.subscriptionCanceledAt,
        kiwifyEmail: accounts.kiwifyCustomerEmail,
        maxAgentSeats: accounts.maxAgentSeats,
      })
      .from(accounts)
      .where(eq(accounts.id, ctx.accountId))
      .limit(1);

    return NextResponse.json({
      plan: row?.plan ?? null,
      status: row?.status ?? "none",
      renews_at: row?.renewsAt ?? null,
      canceled_at: row?.canceledAt ?? null,
      kiwify_email: row?.kiwifyEmail ?? null,
      max_agent_seats: row?.maxAgentSeats ?? 0,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
