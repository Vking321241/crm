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
import { conversations, contacts, departments, messages, messageReactions, users } from "@/db/schema";
import { toApiMessage, toApiReaction, loadOwnedConversation } from "../../_shared";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { loadInstance, toUazapiConfig } from "@/lib/whatsapp/instance-context";
import { sendText, sendMedia, type UazapiMediaType } from "@/lib/whatsapp/uazapi-client";
import { readAccountFileAsBase64 } from "@/lib/storage/server-files";

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

    // Sender's display name, for the small "sent by X" label
    // audio/video bubbles show in the CRM UI (see message-bubble.tsx)
    // instead of baking a signature into content that can't carry one.
    const senderIds = [...new Set(rows.map((m) => m.senderId).filter((v): v is string => !!v))];
    const senderNameById = new Map<string, string>();
    if (senderIds.length) {
      const senderRows = await ctx.db
        .select({ id: users.id, fullName: users.fullName })
        .from(users)
        .where(inArray(users.id, senderIds));
      for (const u of senderRows) senderNameById.set(u.id, u.fullName);
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
        sender_name: m.senderId ? senderNameById.get(m.senderId) : undefined,
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

    // Bold "*Setor - Nome*" signature, auto-prepended to text/image/
    // document sends for whoever has a "setor" assigned (Configurações
    // → Membros). Deliberately skipped for audio/video — WhatsApp
    // voice notes can't carry a caption at all, and the client asked
    // for those two to identify the sender in the CRM's own UI
    // instead (see message-bubble.tsx, driven by messages.sender_id)
    // rather than baking it into the WhatsApp content itself.
    const appliesSignature = body.message_type === "text" || body.message_type === "image" || body.message_type === "document";
    let signature: string | null = null;
    if (appliesSignature) {
      const [sender] = await ctx.db
        .select({ fullName: users.fullName, departmentName: departments.name })
        .from(users)
        .leftJoin(departments, eq(departments.id, users.departmentId))
        .where(eq(users.id, ctx.userId))
        .limit(1);
      if (sender?.departmentName) {
        signature = `*${sender.departmentName} - ${sender.fullName}*`;
      }
    }
    const withSignature = (text: string | undefined | null): string | undefined => {
      const trimmed = text?.trim() || "";
      if (!signature) return trimmed || undefined;
      return trimmed ? `${signature}\n${trimmed}` : signature;
    };

    const outboundText =
      body.message_type === "text" ? withSignature(body.content_text)! : body.content_text?.trim();
    const outboundCaption = appliesSignature && isMedia ? withSignature(body.content_text) : body.content_text || undefined;

    let result;
    if (isMedia) {
      // UAZAPI can't authenticate against our own /api/files/<id>
      // URL, so hand it the raw bytes as base64 instead of a URL it
      // has no way to fetch — see src/lib/storage/server-files.ts.
      const stored = await readAccountFileAsBase64(body.media_url!, ctx.accountId);
      if (!stored) {
        return NextResponse.json({ error: "Arquivo de mídia não encontrado" }, { status: 400 });
      }
      result = await sendMedia(
        cfg,
        contact.phone,
        body.message_type as UazapiMediaType,
        stored.base64,
        outboundCaption,
        body.filename,
      );
    } else {
      result = await sendText(cfg, contact.phone, outboundText!);
    }

    // What lands in our own DB (and therefore the inbox UI) matches
    // exactly what was sent to WhatsApp for text/image/document, so
    // the signature shows up consistently in both places — never a
    // second, disconnected copy of the text.
    const storedContentText = isMedia ? outboundCaption ?? null : outboundText ?? null;

    const [inserted] = await ctx.db
      .insert(messages)
      .values({
        conversationId: id,
        senderType: "agent",
        senderId: ctx.userId,
        contentType: body.message_type as (typeof messages.$inferInsert)["contentType"],
        contentText: storedContentText,
        mediaUrl: isMedia ? body.media_url : null,
        messageId: result.ok ? result.data?.externalId ?? null : null,
        status: result.ok ? "sent" : "failed",
        replyToMessageId: body.reply_to_message_id ?? null,
      })
      .returning();

    await ctx.db
      .update(conversations)
      .set({
        lastMessageText: isMedia ? storedContentText || `[${body.message_type}]` : storedContentText!,
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
