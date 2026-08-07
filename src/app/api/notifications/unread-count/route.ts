import { NextResponse } from "next/server";
import { and, count, eq, isNull } from "drizzle-orm";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { notifications } from "@/db/schema";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const [{ value }] = await ctx.db
      .select({ value: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, ctx.userId), isNull(notifications.readAt)));
    return NextResponse.json({ count: value });
  } catch (err) {
    return toErrorResponse(err);
  }
}
