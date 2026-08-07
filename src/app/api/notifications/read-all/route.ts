import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { notifications } from "@/db/schema";

export async function POST() {
  try {
    const ctx = await getCurrentAccount();
    await ctx.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, ctx.userId), isNull(notifications.readAt)));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
