// ============================================================
// POST /api/conversations/[id]/reactions
//
// Agent reacts to (or swaps their reaction on) a message. Upserts
// on the (message_id, actor_type, actor_id) unique index so
// swapping emoji is a single statement. Removal is a separate
// endpoint: DELETE /api/conversations/[id]/reactions/[messageId].
// ============================================================

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { messages, messageReactions } from "@/db/schema";
import { toApiReaction, loadOwnedConversation } from "../../_shared";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;

    const limit = checkRateLimit(`conversations:react:${ctx.userId}`, RATE_LIMITS.react);
    if (!limit.success) return rateLimitResponse(limit);

    const conversation = await loadOwnedConversation(ctx.db, ctx.accountId, id);
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as
      | { message_id?: string; emoji?: string }
      | null;
    if (!body?.message_id || !body.emoji) {
      return NextResponse.json({ error: "message_id and emoji are required" }, { status: 400 });
    }

    const [message] = await ctx.db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.id, body.message_id), eq(messages.conversationId, id)))
      .limit(1);
    if (!message) {
      return NextResponse.json({ error: "Message not found in this conversation" }, { status: 404 });
    }

    const [row] = await ctx.db
      .insert(messageReactions)
      .values({
        messageId: body.message_id,
        conversationId: id,
        actorType: "agent",
        actorId: ctx.userId,
        emoji: body.emoji,
      })
      .onConflictDoUpdate({
        target: [messageReactions.messageId, messageReactions.actorType, messageReactions.actorId],
        set: { emoji: body.emoji },
      })
      .returning();

    return NextResponse.json({ reaction: toApiReaction(row) }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
