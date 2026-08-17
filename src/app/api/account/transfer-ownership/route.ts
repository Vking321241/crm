// ============================================================
// POST /api/account/transfer-ownership
//
// Owner only. Atomically:
//   - demotes the current owner to 'manager'
//   - promotes the target member to 'owner'
//   - updates accounts.owner_user_id
//
// Fatia 3: reimplements the `transfer_account_ownership` SECURITY
// DEFINER RPC (migration 018) as a Drizzle transaction — demote
// happens before promote so the "zero owners" state is never
// visible, same guarantee the RPC gave.
// ============================================================

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { accounts, users } from "@/db/schema";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

function looksLikeUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("owner");

    const limit = checkRateLimit(`admin:transferOwnership:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { newOwnerUserId?: unknown }
      | null;
    const newOwnerUserId = body?.newOwnerUserId;

    if (!looksLikeUuid(newOwnerUserId)) {
      return NextResponse.json({ error: "'newOwnerUserId' must be a valid UUID" }, { status: 400 });
    }
    if (newOwnerUserId === ctx.userId) {
      return NextResponse.json({ error: "You are already the owner" }, { status: 400 });
    }

    const [target] = await ctx.db
      .select({ accountId: users.accountId })
      .from(users)
      .where(eq(users.id, newOwnerUserId))
      .limit(1);

    if (!target) {
      return NextResponse.json({ error: "Target user not found" }, { status: 400 });
    }
    if (target.accountId !== ctx.accountId) {
      return NextResponse.json(
        { error: "Target user is not a member of your account" },
        { status: 403 },
      );
    }

    await ctx.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ accountRole: "manager", updatedAt: new Date() })
        .where(eq(users.id, ctx.userId));
      await tx
        .update(users)
        .set({ accountRole: "owner", updatedAt: new Date() })
        .where(eq(users.id, newOwnerUserId));
      await tx
        .update(accounts)
        .set({ ownerUserId: newOwnerUserId, updatedAt: new Date() })
        .where(eq(accounts.id, ctx.accountId));
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
