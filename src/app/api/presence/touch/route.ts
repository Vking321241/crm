import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { memberPresence } from "@/db/schema";

// POST /api/presence/touch — replaces the touch_presence() SECURITY
// DEFINER RPC. Account is resolved from the caller's own session
// (never client-supplied), same guarantee the RPC gave.
export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const body = (await request.json().catch(() => null)) as { status?: string } | null;
    const status = body?.status === "away" ? "away" : "online";

    await ctx.db
      .insert(memberPresence)
      .values({ userId: ctx.userId, accountId: ctx.accountId, status, lastSeenAt: new Date() })
      .onConflictDoUpdate({
        target: memberPresence.userId,
        set: { status, lastSeenAt: new Date(), accountId: ctx.accountId },
      });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
