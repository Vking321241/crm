import { NextResponse } from "next/server";
import { and, count, eq, gt } from "drizzle-orm";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { conversations } from "@/db/schema";

// GET /api/conversations/unread-count — number of conversations with
// at least one unread inbound message, for the sidebar's Inbox badge.
// Kept as its own tiny route (separate from the CRUD conversation
// routes) since it's polled frequently and only needs one column.
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const [{ value }] = await ctx.db
      .select({ value: count() })
      .from(conversations)
      .where(and(eq(conversations.accountId, ctx.accountId), gt(conversations.unreadCount, 0)));

    return NextResponse.json({ count: value });
  } catch (err) {
    return toErrorResponse(err);
  }
}
