// ============================================================
// /api/account
//
//   GET   — current caller's account + role. Any member.
//   PATCH — rename the account.                  Admin+.
//
// Why both verbs share a route file
//   They speak about the same singular resource (the caller's
//   account) and reuse the same `requireRole` plumbing. Splitting
//   them across files would duplicate the `account_id` lookup
//   without buying anything.
// ============================================================

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import {
  requireRole,
  getCurrentAccount,
  toErrorResponse,
} from "@/lib/auth/account";
import { accounts } from "@/db/schema";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    return NextResponse.json({
      account: ctx.account,
      role: ctx.role,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const MAX_NAME_LEN = 80;

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("admin");

    // Per-user limit on admin-class mutations. Bounds accidental
    // abuse (script run in a loop) and a compromised admin session
    // spamming renames. Each admin endpoint keys its own bucket so
    // one route doesn't starve another.
    const limit = checkRateLimit(
      `admin:rename:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | { name?: unknown }
      | null;
    const rawName = body?.name;

    if (typeof rawName !== "string") {
      return NextResponse.json(
        { error: "'name' must be a string" },
        { status: 400 },
      );
    }

    const name = rawName.trim();
    if (name.length === 0) {
      return NextResponse.json(
        { error: "Account name cannot be empty" },
        { status: 400 },
      );
    }
    if (name.length > MAX_NAME_LEN) {
      return NextResponse.json(
        { error: `Account name must be ${MAX_NAME_LEN} characters or fewer` },
        { status: 400 },
      );
    }

    // requireRole already guaranteed the caller is admin+ of this
    // account — the WHERE clause is the tenancy boundary (no RLS).
    const [data] = await ctx.db
      .update(accounts)
      .set({ name, updatedAt: new Date() })
      .where(eq(accounts.id, ctx.accountId))
      .returning({ id: accounts.id, name: accounts.name });

    if (!data) {
      return NextResponse.json(
        { error: "Failed to update account" },
        { status: 500 },
      );
    }

    return NextResponse.json({ account: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
