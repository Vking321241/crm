import { NextResponse } from "next/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { notifications } from "@/db/schema";

// GET /api/notifications?unreadOnly=true&limit=50
export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const { searchParams } = new URL(request.url);
    const unreadOnly = searchParams.get("unreadOnly") === "true";
    const limit = Math.min(Number(searchParams.get("limit")) || 50, 200);

    const rows = await ctx.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, ctx.userId),
          unreadOnly ? isNull(notifications.readAt) : sql`true`,
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(limit);

    return NextResponse.json({ notifications: rows });
  } catch (err) {
    return toErrorResponse(err);
  }
}
