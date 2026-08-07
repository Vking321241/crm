import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { notifications } from "@/db/schema";

// PATCH /api/notifications/[id]/read — the only mutation a client is
// allowed to make on a notification (mirrors the old column-level
// GRANT UPDATE (read_at) policy).
export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;

    await ctx.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, ctx.userId)));

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
