// ============================================================
// GET /api/account/members
//
// Lists every member of the caller's account. Any member can call
// it (the Members tab is shown to admins+, but agents/viewers see
// a read-only roster too).
//
// Field visibility
//   Sensitive fields (email) are returned only when the caller is
//   admin+. Agents and viewers see name + avatar + role + joined
//   date only. This mirrors the design decision from the planning
//   phase: "agent/viewer sees names only".
// ============================================================

import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { canManageMembers } from "@/lib/auth/roles";
import { users } from "@/db/schema";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const rows = await ctx.db
      .select({
        userId: users.id,
        fullName: users.fullName,
        email: users.email,
        avatarUrl: users.avatarUrl,
        role: users.accountRole,
        joinedAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.accountId, ctx.accountId))
      .orderBy(asc(users.createdAt));

    const canSeeEmails = canManageMembers(ctx.role);

    const members = rows.map((row) => ({
      user_id: row.userId,
      full_name: row.fullName,
      email: canSeeEmails ? row.email : null,
      avatar_url: row.avatarUrl,
      role: row.role,
      joined_at: row.joinedAt,
    }));

    return NextResponse.json({ members });
  } catch (err) {
    return toErrorResponse(err);
  }
}
