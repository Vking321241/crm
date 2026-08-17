// ============================================================
// GET /api/conversations/[id]/spy — read-only, silent thread fetch
// for the Modo Espião monitor modal. Deliberately a separate route
// from GET /api/conversations/[id]/messages: that route resets
// unread_count as a side effect of "opening" the thread, which would
// tip off the assigned agent that someone read their queue. This one
// never touches unread_count — true silent monitoring.
// ============================================================

import { NextResponse } from "next/server";
import { asc, eq, inArray } from "drizzle-orm";

import { requireModule, toErrorResponse } from "@/lib/auth/account";
import { messages, messageReactions } from "@/db/schema";
import { toApiMessage, toApiReaction, loadOwnedConversation } from "../../_shared";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireModule("spy_mode");
    const { id } = await params;

    const conversation = await loadOwnedConversation(ctx.db, ctx.accountId, id);
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const rows = await ctx.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt));

    const messageIds = rows.map((m) => m.id);
    const reactionRows = messageIds.length
      ? await ctx.db
          .select()
          .from(messageReactions)
          .where(inArray(messageReactions.messageId, messageIds))
      : [];

    const reactionsByMessage = new Map<string, ReturnType<typeof toApiReaction>[]>();
    for (const r of reactionRows) {
      const bucket = reactionsByMessage.get(r.messageId);
      const mapped = toApiReaction(r);
      if (bucket) bucket.push(mapped);
      else reactionsByMessage.set(r.messageId, [mapped]);
    }

    return NextResponse.json({
      messages: rows.map((m) => ({
        ...toApiMessage(m),
        reactions: reactionsByMessage.get(m.id) ?? [],
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
