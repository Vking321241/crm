// ============================================================
// DELETE /api/conversations/[id]/reactions/[messageId]
//
// Removes the caller's own reaction on a message. Only the agent's
// own reaction — one reaction per (message, actor) by design.
// ============================================================

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { messageReactions, messages, contacts } from "@/db/schema";
import { loadOwnedConversation } from "../../../_shared";
import { loadInstance, toUazapiConfig } from "@/lib/whatsapp/instance-context";
import { sendReaction } from "@/lib/whatsapp/uazapi-client";

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

    // Best-effort: clear the reaction on the customer's phone too
    // (empty text removes a reaction in UAZAPI's API).
    try {
      const [message] = await ctx.db
        .select({ externalId: messages.messageId })
        .from(messages)
        .where(eq(messages.id, messageId))
        .limit(1);
      if (message?.externalId) {
        const instance = await loadInstance(ctx, ctx.accountId);
        if (instance?.uazapiUrl && instance.token) {
          const [contact] = await ctx.db
            .select({ phone: contacts.phone })
            .from(contacts)
            .where(eq(contacts.id, conversation.contactId))
            .limit(1);
          if (contact) {
            await sendReaction(toUazapiConfig(instance), contact.phone, message.externalId, "");
          }
        }
      }
    } catch (err) {
      console.error("[DELETE /reactions] UAZAPI reaction clear error:", err);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
