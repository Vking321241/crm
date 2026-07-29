import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { requirePlatformOwner, toErrorResponse } from "@/lib/auth/account";
import { accounts } from "@/db/schema";

// PATCH /api/admin/clients/[accountId] — platform-owner-only seat
// quota edit. The invitations route (src/app/api/account/invitations)
// is the enforcement point that reads this value back; this route is
// the only writer.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ accountId: string }> },
) {
  try {
    const ctx = await requirePlatformOwner();
    const { accountId } = await params;

    const body = (await request.json().catch(() => null)) as {
      maxAgentSeats?: number;
    } | null;

    const maxAgentSeats = body?.maxAgentSeats;
    if (typeof maxAgentSeats !== "number" || maxAgentSeats < 1) {
      return NextResponse.json(
        { error: "maxAgentSeats deve ser um número maior ou igual a 1" },
        { status: 400 },
      );
    }

    await ctx.db
      .update(accounts)
      .set({ maxAgentSeats: Math.floor(maxAgentSeats), updatedAt: new Date() })
      .where(and(eq(accounts.id, accountId), eq(accounts.isPlatform, false)));

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
