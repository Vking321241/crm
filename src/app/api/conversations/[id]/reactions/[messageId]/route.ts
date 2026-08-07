// ============================================================
// DELETE /api/conversations/[id]/reactions/[messageId]
//
// Removes the caller's own reaction on a message. Only the agent's
// own reaction — one reaction per (message, actor) by design.
// ============================================================

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { messageReactions } from "@/db/schema";
import { loadOwnedConversation } from "../../../_shared";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id, messageId } = await params;

    const conversation = await loadOwnedConversation(ctx.db, ctx.accountId, id);
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    await ctx.db
      .delete(messageReactions)
      .where(
        and(
          eq(messageReactions.messageId, messageId),
          eq(messageReactions.conversationId, id),
          eq(messageReactions.actorType, "agent"),
          eq(messageReactions.actorId, ctx.userId),
        ),
      );

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
