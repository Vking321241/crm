// ============================================================
// DELETE /api/account/invitations/[id]
//
// Admin+. Revokes a pending invite (an `auth_tokens` row with
// purpose='invite', Fatia 2). No RLS anymore — the `accountId`
// filter below IS the tenancy boundary, replacing what the old
// `account_invitations` RLS policy did.
// ============================================================

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { authTokens } from "@/db/schema";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(`admin:inviteRevoke:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    const deleted = await ctx.db
      .delete(authTokens)
      .where(
        and(
          eq(authTokens.id, id),
          eq(authTokens.purpose, "invite"),
          eq(authTokens.accountId, ctx.accountId),
        ),
      )
      .returning({ id: authTokens.id });

    if (deleted.length === 0) {
      return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
