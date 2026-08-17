import { NextResponse, after } from "next/server";
import { eq, and, asc } from "drizzle-orm";

import { db } from "@/db/client";
import {
  whatsappInstances,
  accounts,
  contacts,
  conversations,
  messages,
  autoReplySettings,
  DEFAULT_BUSINESS_HOURS,
} from "@/db/schema";
import { findExistingContactDb, isUniqueViolation } from "@/lib/contacts/dedupe";
import { parseUazapiWebhook, sendText, getProfilePicture } from "@/lib/whatsapp/uazapi-client";
import { decrypt } from "@/lib/whatsapp/encryption";
import { resolveAutoReply, isThrottled, type BusinessHours } from "@/lib/automations/auto-reply-rules";
import { saveInboundMedia } from "@/lib/storage/server-files";

// The UAZAPI webhook is registered per-instance
// (`/api/whatsapp/uazapi/webhook/<instanceId>`, wired up by
// configureWebhook() right after a successful connect — see
// src/app/api/whatsapp/instance/status/route.ts). The instance id
// in the URL is how we resolve which client account owns an
// inbound event, without depending on UAZAPI's payload to name the
// instance itself.
//
// Reads/writes go through the same Drizzle/Postgres stack as the
// rest of the CRM (src/db/schema.ts) — this used to talk to
// Supabase, which no longer holds these tables since Fatia 3 moved
// them here; that mismatch was why inbound messages never reached
// the Inbox. Mirrors the outbound path in
// src/app/api/conversations/[id]/messages/route.ts. Deliberately
// does not wire up automations, flows, or the AI auto-reply engine:
// those modules are not part of DivaryTalk.

export async function POST(
  request: Request,
  { params }: { params: Promise<{ instanceId: string }> },
) {
  const { instanceId } = await params;
  const body = await request.json().catch(() => null);

  // Ack immediately, process after — same reasoning as before:
  // `after()` keeps the function alive for the DB writes below even
  // on a serverless runtime that could otherwise freeze right after
  // the response is sent.
  after(async () => {
    try {
      await processInbound(instanceId, body);
    } catch (err) {
      console.error("[uazapi webhook] processing error:", err);
    }
  });

  return NextResponse.json({ status: "received" }, { status: 200 });
}

async function processInbound(instanceId: string, body: unknown) {
  const parsed = parseUazapiWebhook(body);
  if (!parsed) return;

  const [row] = await db
    .select({
      accountId: whatsappInstances.accountId,
      ownerUserId: accounts.ownerUserId,
      uazapiUrl: whatsappInstances.uazapiUrl,
      uazapiToken: whatsappInstances.uazapiToken,
    })
    .from(whatsappInstances)
    .innerJoin(accounts, eq(accounts.id, whatsappInstances.accountId))
    .where(eq(whatsappInstances.id, instanceId))
    .limit(1);

  if (!row) {
    console.error("[uazapi webhook] unknown instance id:", instanceId);
    return;
  }

  const { accountId, ownerUserId } = row;
  if (!ownerUserId) {
    console.error("[uazapi webhook] instance has no resolvable account owner:", instanceId);
    return;
  }

  // Group chats aren't modeled as contacts/conversations in this
  // slice — same scope boundary as everything else in this fatia.
  if (parsed.isGroup) return;
  if (!parsed.phone) return;

  const { contact, wasCreated } = await findOrCreateContact(
    accountId,
    ownerUserId,
    parsed.phone,
    parsed.contactName,
  );
  if (!contact) return;

  const conversation = await findOrCreateConversation(accountId, ownerUserId, contact.id);
  if (!conversation) return;

  // Best-effort: pull the contact's WhatsApp profile photo the first
  // time we hear from them (never overwrites one they/we already
  // have). Re-hosted through our own storage, same reasoning as
  // saveInboundMedia below — UAZAPI's own image URL isn't guaranteed
  // to stay fetchable by the browser.
  if (!contact.avatarUrl && row.uazapiUrl && row.uazapiToken) {
    try {
      const picResult = await getProfilePicture(
        { baseUrl: row.uazapiUrl, token: decrypt(row.uazapiToken) },
        parsed.phone,
      );
      if (picResult.ok && picResult.data) {
        const savedUrl = await saveInboundMedia({
          accountId,
          sourceUrl: picResult.data.url,
          sourceBase64: null,
          mimeType: "image/jpeg",
          instanceToken: decrypt(row.uazapiToken),
        });
        if (savedUrl) {
          await db
            .update(contacts)
            .set({ avatarUrl: savedUrl, updatedAt: new Date() })
            .where(eq(contacts.id, contact.id));
        }
      }
    } catch (err) {
      console.error("[uazapi webhook] profile picture fetch failed:", err);
    }
  }

  const contentText = parsed.type === "location" ? parsed.text : (parsed.text ?? null);

  // Re-host inbound media through our own authenticated /api/files/<id>
  // instead of trusting UAZAPI's URL to stay fetchable from the
  // browser (auth/expiry) — see src/lib/storage/server-files.ts.
  let mediaUrl = parsed.mediaUrl;
  if ((parsed.mediaUrl || parsed.mediaBase64) && row.uazapiUrl && row.uazapiToken) {
    mediaUrl = await saveInboundMedia({
      accountId,
      sourceUrl: parsed.mediaUrl,
      sourceBase64: parsed.mediaBase64,
      mimeType: parsed.mimeType,
      instanceToken: decrypt(row.uazapiToken),
      instanceBaseUrl: row.uazapiUrl,
    });
  }

  try {
    await db.insert(messages).values({
      conversationId: conversation.id,
      senderType: parsed.fromMe ? "agent" : "customer",
      contentType: parsed.type,
      contentText,
      mediaUrl,
      messageId: parsed.externalId,
      status: "delivered",
    });
  } catch (err) {
    console.error("[uazapi webhook] message insert error:", err);
    return;
  }

  try {
    await db
      .update(conversations)
      .set({
        lastMessageText: contentText || `[${parsed.type}]`,
        lastMessageAt: new Date(),
        unreadCount: parsed.fromMe ? conversation.unreadCount : (conversation.unreadCount || 0) + 1,
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversation.id));
  } catch (err) {
    console.error("[uazapi webhook] conversation update error:", err);
  }

  // Rule-based auto-reply (welcome / after-hours / away) — customer
  // messages only, never for our own outbound echoes.
  if (!parsed.fromMe && row.uazapiUrl && row.uazapiToken) {
    await maybeSendAutoReply({
      accountId,
      conversationId: conversation.id,
      lastAutoReplyAt: conversation.lastAutoReplyAt,
      isNewContact: wasCreated,
      to: contact.phone,
      cfg: { baseUrl: row.uazapiUrl, token: decrypt(row.uazapiToken) },
    });
  }
}

async function maybeSendAutoReply(opts: {
  accountId: string;
  conversationId: string;
  lastAutoReplyAt: Date | null;
  isNewContact: boolean;
  to: string;
  cfg: { baseUrl: string; token: string };
}) {
  const now = new Date();
  if (isThrottled(opts.lastAutoReplyAt, now)) return;

  const [settings] = await db
    .select()
    .from(autoReplySettings)
    .where(eq(autoReplySettings.accountId, opts.accountId))
    .limit(1);
  if (!settings) return;

  const reply = resolveAutoReply(
    {
      welcomeEnabled: settings.welcomeEnabled,
      welcomeMessage: settings.welcomeMessage,
      afterHoursEnabled: settings.afterHoursEnabled,
      afterHoursMessage: settings.afterHoursMessage,
      businessHours: (settings.businessHours as BusinessHours) ?? DEFAULT_BUSINESS_HOURS,
      awayEnabled: settings.awayEnabled,
      awayMessage: settings.awayMessage,
    },
    { isNewContact: opts.isNewContact, now },
  );
  if (!reply) return;

  const result = await sendText(opts.cfg, opts.to, reply.text);
  if (!result.ok) {
    console.error("[uazapi webhook] auto-reply send error:", result.error);
    return;
  }

  try {
    await db.insert(messages).values({
      conversationId: opts.conversationId,
      senderType: "bot",
      contentType: "text",
      contentText: reply.text,
      messageId: result.data?.externalId ?? null,
      status: "sent",
    });
    await db
      .update(conversations)
      .set({
        lastMessageText: reply.text,
        lastMessageAt: now,
        lastAutoReplyAt: now,
        updatedAt: now,
      })
      .where(eq(conversations.id, opts.conversationId));
  } catch (err) {
    console.error("[uazapi webhook] auto-reply message insert error:", err);
  }
}

async function findOrCreateContact(
  accountId: string,
  ownerUserId: string,
  phone: string,
  name: string | null,
) {
  const existing = await findExistingContactDb(db, accountId, phone);
  if (existing) {
    if (name && name !== existing.name) {
      await db
        .update(contacts)
        .set({ name, updatedAt: new Date() })
        .where(eq(contacts.id, existing.id));
    }
    return { contact: existing, wasCreated: false };
  }

  try {
    const [created] = await db
      .insert(contacts)
      .values({
        accountId,
        userId: ownerUserId,
        phone,
        name: name || phone,
      })
      .returning();
    return { contact: created, wasCreated: true };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { contact: await findExistingContactDb(db, accountId, phone), wasCreated: false };
    }
    console.error("[uazapi webhook] contact insert error:", err);
    return { contact: null, wasCreated: false };
  }
}

async function findOrCreateConversation(accountId: string, ownerUserId: string, contactId: string) {
  const existing = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.accountId, accountId), eq(conversations.contactId, contactId)))
    .orderBy(asc(conversations.createdAt))
    .limit(1);

  if (existing.length > 0) return existing[0];

  try {
    const [created] = await db
      .insert(conversations)
      .values({ accountId, userId: ownerUserId, contactId })
      .returning();
    return created;
  } catch (err) {
    if (isUniqueViolation(err)) {
      const raced = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.accountId, accountId), eq(conversations.contactId, contactId)))
        .orderBy(asc(conversations.createdAt))
        .limit(1);
      if (raced.length > 0) return raced[0];
    }
    console.error("[uazapi webhook] conversation insert error:", err);
    return null;
  }
}
