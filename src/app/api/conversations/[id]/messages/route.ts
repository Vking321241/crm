// ============================================================
// GET  /api/conversations/[id]/messages — full thread, oldest
//      first, reactions embedded per message. Opening the thread
//      (i.e. calling this route) also resets the conversation's
//      `unread_count` to 0 — this replaces the old client-side
//      `UPDATE conversations SET unread_count = 0` the thread fired
//      once realtime told it a conversation was active.
//
// POST /api/conversations/[id]/messages — send a text or media
//      message via UAZAPI (agent+). Always writes a `messages` row,
//      even when the UAZAPI call fails (status becomes 'failed' so
//      the agent can see it in the UI), except when there's no
//      connected WhatsApp instance at all — that's a hard 400, no
//      row written, since there's nothing to retry against.
// ============================================================

import { NextResponse } from "next/server";
import { asc, eq, inArray } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { conversations, contacts, messages, messageReactions } from "@/db/schema";
import { toApiMessage, toApiReaction, loadOwnedConversation } from "../../_shared";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { loadInstance, toUazapiConfig } from "@/lib/whatsapp/instance-context";
import { sendText, sendMedia, type UazapiMediaType } from "@/lib/whatsapp/uazapi-client";

const MEDIA_TYPES = new Set(["image", "video", "document", "audio"]);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("viewer");
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

    if (conversation.unreadCount > 0) {
      await ctx.db
        .update(conversations)
        .set({ unreadCount: 0 })
        .where(eq(conversations.id, id));
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

interface SendBody {
  message_type?: string;
  content_text?: string;
  media_url?: string;
  filename?: string;
  reply_to_message_id?: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;

    const limit = checkRateLimit(`conversations:send:${ctx.userId}`, RATE_LIMITS.send);
    if (!limit.success) return rateLimitResponse(limit);

    const conversation = await loadOwnedConversation(ctx.db, ctx.accountId, id);
    if (!conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const [contact] = await ctx.db
      .select()
      .from(contacts)
      .where(eq(contacts.id, conversation.contactId))
      .limit(1);
    if (!contact) {
      return NextResponse.json({ error: "Contact not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as SendBody | null;
    if (!body || typeof body.message_type !== "string") {
      return NextResponse.json({ error: "message_type is required" }, { status: 400 });
    }

    const isMedia = MEDIA_TYPES.has(body.message_type);
    if (!isMedia && body.message_type !== "text") {
      return NextResponse.json({ error: `Unsupported message_type: ${body.message_type}` }, { status: 400 });
    }
    if (isMedia && !body.media_url) {
      return NextResponse.json({ error: "media_url is required for media messages" }, { status: 400 });
    }
    if (!isMedia && !body.content_text?.trim()) {
      return NextResponse.json({ error: "content_text is required" }, { status: 400 });
    }

    const instance = await loadInstance(ctx, ctx.accountId);
    if (!instance || instance.status !== "connected") {
      return NextResponse.json(
        { error: "WhatsApp não conectado — conecte em Configurações" },
        { status: 400 },
      );
    }
    const cfg = toUazapiConfig(instance);

    const result = isMedia
      ? await sendMedia(
          cfg,
          contact.phone,
          body.message_type as UazapiMediaType,
          body.media_url!,
          body.content_text || undefined,
          body.filename,
        )
      : await sendText(cfg, contact.phone, body.content_text!.trim());

    const [inserted] = await ctx.db
      .insert(messages)
      .values({
        conversationId: id,
        senderType: "agent",
        senderId: ctx.userId,
        contentType: body.message_type as (typeof messages.$inferInsert)["contentType"],
        contentText: body.content_text?.trim() || null,
        mediaUrl: isMedia ? body.media_url : null,
        messageId: result.ok ? result.data?.externalId ?? null : null,
        status: result.ok ? "sent" : "failed",
        replyToMessageId: body.reply_to_message_id ?? null,
      })
      .returning();

    await ctx.db
      .update(conversations)
      .set({
        lastMessageText: isMedia ? body.content_text?.trim() || `[${body.message_type}]` : body.content_text!.trim(),
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, id));

    return NextResponse.json(
      {
        message: { ...toApiMessage(inserted), reactions: [] },
        ...(result.ok ? {} : { error: result.error || "UAZAPI send failed" }),
      },
      { status: result.ok ? 201 : 200 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
