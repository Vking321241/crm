// ============================================================
// PATCH  /api/conversations/[id]/messages/[messageId] — edit the
//        text of a message this account sent, within
//        MESSAGE_EDIT_WINDOW_MINUTES of sending. Body: { text }.
// DELETE /api/conversations/[id]/messages/[messageId] — "delete for
//        everyone" a message this account sent.
//
// Both agent+, and both restricted to messages this same WhatsApp
// number sent (sender_type agent/bot) — WhatsApp has no concept of
// editing/revoking a message the OTHER side sent, so there is
// nothing to call for a customer's message. Any agent can act on any
// teammate's send (they all go out from the one shared business
// number), not just the original sender.
// ============================================================

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { contacts, messages } from "@/db/schema";
import { loadOwnedConversation } from "../../../_shared";
import { loadInstance, toUazapiConfig } from "@/lib/whatsapp/instance-context";
import { deleteMessage, editMessage, MESSAGE_EDIT_WINDOW_MINUTES } from "@/lib/whatsapp/uazapi-client";

async function loadOwnMessage(
  db: import("@/db/client").Db,
  conversationId: string,
  messageId: string,
) {
  const [row] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.conversationId, conversationId)))
    .limit(1);
  if (!row) return null;
  if (row.senderType !== "agent" && row.senderType !== "bot") return null;
  if (!row.messageId) return null; // no UAZAPI id to act on (send never confirmed)
  if (row.deletedAt) return null;
  return row;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; messageId: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id, messageId } = await params;

    const conversation = await loadOwnedConversation(ctx.db, ctx.accountId, id);
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) {
      return NextResponse.json({ error: "'text' is required" }, { status: 400 });
    }

    const message = await loadOwnMessage(ctx.db, id, messageId);
    if (!message) {
      return NextResponse.json({ error: "Message not found or not editable" }, { status: 404 });
    }
    if (message.contentType !== "text") {
      return NextResponse.json({ error: "Only text messages can be edited" }, { status: 400 });
    }

    const ageMinutes = (Date.now() - message.createdAt.getTime()) / 60_000;
    if (ageMinutes > MESSAGE_EDIT_WINDOW_MINUTES) {
      return NextResponse.json(
        { error: `O prazo de ${MESSAGE_EDIT_WINDOW_MINUTES} minutos para editar essa mensagem já passou` },
        { status: 400 },
      );
    }

    const [contact] = await ctx.db
      .select({ phone: contacts.phone })
      .from(contacts)
      .where(eq(contacts.id, conversation.contactId))
      .limit(1);
    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const instance = await loadInstance(ctx, ctx.accountId);
    if (!instance || instance.status !== "connected") {
      return NextResponse.json(
        { error: "WhatsApp não conectado — conecte em Configurações" },
        { status: 400 },
      );
    }

    const result = await editMessage(toUazapiConfig(instance), contact.phone, message.messageId!, text);
    if (!result.ok) {
      return NextResponse.json({ error: result.error || "Falha ao editar no WhatsApp" }, { status: 502 });
    }

    await ctx.db
      .update(messages)
      .set({ contentText: text, editedAt: new Date() })
      .where(eq(messages.id, messageId));

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

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

    const message = await loadOwnMessage(ctx.db, id, messageId);
    if (!message) {
      return NextResponse.json({ error: "Message not found or not deletable" }, { status: 404 });
    }

    const [contact] = await ctx.db
      .select({ phone: contacts.phone })
      .from(contacts)
      .where(eq(contacts.id, conversation.contactId))
      .limit(1);
    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const instance = await loadInstance(ctx, ctx.accountId);
    if (!instance || instance.status !== "connected") {
      return NextResponse.json(
        { error: "WhatsApp não conectado — conecte em Configurações" },
        { status: 400 },
      );
    }

    const result = await deleteMessage(toUazapiConfig(instance), contact.phone, message.messageId!);
    if (!result.ok) {
      return NextResponse.json({ error: result.error || "Falha ao apagar no WhatsApp" }, { status: 502 });
    }

    await ctx.db.update(messages).set({ deletedAt: new Date() }).where(eq(messages.id, messageId));

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
