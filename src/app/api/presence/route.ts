import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { memberPresence } from "@/db/schema";

// GET /api/presence — presence roster for the caller's account.
// Replaces the Realtime subscription on member_presence; the
// consuming hook polls this instead.
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const rows = await ctx.db
      .select({
        userId: memberPresence.userId,
        status: memberPresence.status,
        lastSeenAt: memberPresence.lastSeenAt,
      })
      .from(memberPresence)
      .where(eq(memberPresence.accountId, ctx.accountId));

    return NextResponse.json({ presence: rows });
  } catch (err) {
    return toErrorResponse(err);
  }
}
