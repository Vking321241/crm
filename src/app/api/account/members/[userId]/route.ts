// ============================================================
// /api/account/members/[userId]
//
//   PATCH  — change a member's role.   Admin+.
//   DELETE — remove a member.          Admin+.
//
// Fatia 3: the business rules that used to live in the
// SECURITY DEFINER RPCs `set_member_role`/`remove_account_member`
// (migration 018) are reimplemented here in TS, since there's no
// RLS boundary to bypass anymore — this route IS the authority.
//
// Removing a member deletes their `users` row outright (cascades to
// their sessions) rather than spinning up a fresh personal account
// the way the Supabase-era RPC did — DivaryTalk's closed
// provisioning model has no self-service "personal account" concept
// to relocate them to; removal just revokes access and frees a seat.
// ============================================================

import { NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";

import { requireRole, toErrorResponse, ForbiddenError } from "@/lib/auth/account";
import { isAccountRole } from "@/lib/auth/roles";
import { departments, users } from "@/db/schema";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(`admin:memberRole:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as
      | { role?: unknown; department_id?: unknown }
      | null;

    const hasRole = body && "role" in body;
    const hasDepartment = body && "department_id" in body;
    if (!hasRole && !hasDepartment) {
      return NextResponse.json({ error: "'role' or 'department_id' is required" }, { status: 400 });
    }

    const role = body?.role;
    if (hasRole) {
      if (!isAccountRole(role)) {
        return NextResponse.json(
          { error: "'role' must be one of owner, admin, agent, viewer" },
          { status: 400 },
        );
      }
      if (role === "owner") {
        return NextResponse.json(
          { error: "Use POST /api/account/transfer-ownership to promote a member to owner" },
          { status: 400 },
        );
      }
      if (userId === ctx.userId) {
        return NextResponse.json({ error: "Cannot change your own role" }, { status: 400 });
      }
    }

    let departmentId: string | null | undefined;
    if (hasDepartment) {
      const raw = body?.department_id;
      if (raw !== null && typeof raw !== "string") {
        return NextResponse.json({ error: "'department_id' must be a string or null" }, { status: 400 });
      }
      if (raw) {
        const [dept] = await ctx.db
          .select({ id: departments.id })
          .from(departments)
          .where(and(eq(departments.id, raw), eq(departments.accountId, ctx.accountId)))
          .limit(1);
        if (!dept) {
          return NextResponse.json({ error: "Department not found" }, { status: 400 });
        }
      }
      departmentId = raw;
    }

    const [target] = await ctx.db
      .select({ accountId: users.accountId, role: users.accountRole })
      .from(users)
      .where(eq(users.id, userId))
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
    if (hasRole && target.role === "owner") {
      return NextResponse.json(
        { error: "Use transfer ownership to demote an owner" },
        { status: 400 },
      );
    }

    const update: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    if (hasRole) update.accountRole = role as (typeof users.$inferInsert)["accountRole"];
    if (hasDepartment) update.departmentId = departmentId;

    await ctx.db.update(users).set(update).where(eq(users.id, userId));

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(`admin:memberRemove:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    if (userId === ctx.userId) {
      throw new ForbiddenError("Cannot remove yourself; transfer ownership first");
    }

    const [target] = await ctx.db
      .select({ accountId: users.accountId, role: users.accountRole })
      .from(users)
      .where(eq(users.id, userId))
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
    if (target.role === "owner") {
      return NextResponse.json(
        { error: "Cannot remove the account owner; transfer ownership first" },
        { status: 400 },
      );
    }

    await ctx.db
      .delete(users)
      .where(and(eq(users.id, userId), eq(users.accountId, ctx.accountId), ne(users.accountRole, "owner")));

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
