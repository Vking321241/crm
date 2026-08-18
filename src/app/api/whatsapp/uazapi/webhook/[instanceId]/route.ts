import { NextResponse, after } from "next/server";
import { eq, and, asc, desc, inArray } from "drizzle-orm";

import { db } from "@/db/client";
import {
  whatsappInstances,
  accounts,
  contacts,
  conversations,
  messages,
  messageReactions,
  autoReplySettings,
  webhookDebugLog,
  tags,
  contactTags,
  csatResponses,
  DEFAULT_BUSINESS_HOURS,
} from "@/db/schema";
import { findExistingContactDb, isUniqueViolation } from "@/lib/contacts/dedupe";
import { parseUazapiWebhook, sendText, getProfilePicture, downloadMedia } from "@/lib/whatsapp/uazapi-client";
import { decrypt } from "@/lib/whatsapp/encryption";
import { resolveAutoReply, isThrottled, type BusinessHours } from "@/lib/auto-reply/auto-reply-rules";
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
    await captureDebugLog(body);
  });

  return NextResponse.json({ status: "received" }, { status: 200 });
}

// TEMP — captures every raw inbound webhook body so field-name guesses
// in parseUazapiWebhook can be checked against a real payload via
// GET /api/debug/webhook-log (token-gated, see that route) instead of
// container logs we don't have access to. Keeps only the newest 40
// rows. Best-effort: never let a logging failure affect delivery. Drop
// this whole table + route once the parser is confirmed correct.
async function captureDebugLog(body: unknown) {
  try {
    await db.insert(webhookDebugLog).values({ source: "uazapi", body: body as object });
    const stale = await db
      .select({ id: webhookDebugLog.id })
      .from(webhookDebugLog)
      .orderBy(desc(webhookDebugLog.createdAt))
      .offset(40);
    if (stale.length > 0) {
      await db.delete(webhookDebugLog).where(inArray(webhookDebugLog.id, stale.map((s) => s.id)));
    }
  } catch (err) {
    console.error("[uazapi webhook] debug log capture failed:", err);
  }
}

async function processInbound(instanceId: string, body: unknown) {
  const parsed = parseUazapiWebhook(body);
  if (!parsed) return;

  // TEMP DIAGNOSTIC — the mediaUrl/mediaBase64 field names in
  // parseUazapiWebhook are a best-effort guess, unverified against
  // this account's live UAZAPI install. If a media message comes
  // through with neither resolved, dump the raw payload so the real
  // field names can be read from the container logs and the parser
  // corrected for good. Safe to remove once media send/receive is
  // confirmed working — this does not affect delivery, only logging.
  if (
    (parsed.type === "image" || parsed.type === "audio" || parsed.type === "video" || parsed.type === "document") &&
    !parsed.mediaUrl &&
    !parsed.mediaBase64
  ) {
    console.error(
      "[uazapi webhook] DIAGNOSTIC media message with no resolvable url/base64 — raw payload:",
      JSON.stringify(body).slice(0, 5000),
    );
  }

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

  if (!parsed.phone) return;

  const { contact, wasCreated } = await findOrCreateContact(
    accountId,
    ownerUserId,
    parsed.phone,
    parsed.contactName,
    parsed.isGroup,
  );
  if (!contact) return;

  // First time this group is heard from: tag it "Grupo" so it's
  // identifiable at a glance in Contatos, while staying out of the
  // tag-based reports (tags.is_system) and out of the normal tag
  // manager's editable list.
  if (wasCreated && parsed.isGroup) {
    await tagAsGroup(accountId, contact.id).catch((err) =>
      console.error("[uazapi webhook] group tag error:", err),
    );
  }

  const conversation = await findOrCreateConversation(accountId, ownerUserId, contact.id);
  if (!conversation) return;

  // A reaction to an existing message — never a new message of its
  // own, so it doesn't go through the regular insert below. `fromMe`
  // means the connected number's own phone reacted (not through
  // DivaryTalk's UI, which writes its own reaction directly via
  // POST /conversations/[id]/reactions) — recorded as an "agent"
  // reaction with no specific actorId, since the webhook has no way
  // to know which teammate touched the phone. An empty emoji means
  // the reaction was removed, mirrored as a delete.
  if (parsed.type === "reaction") {
    if (!parsed.reactionTargetId) return;
    const [target] = await db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(eq(messages.conversationId, conversation.id), eq(messages.messageId, parsed.reactionTargetId)),
      )
      .limit(1);
    if (!target) {
      console.error(
        "[uazapi webhook] reaction target message not found, externalId:",
        parsed.reactionTargetId,
      );
      return;
    }
    const actorType = parsed.fromMe ? "agent" : "customer";
    try {
      // Delete-then-insert rather than onConflictDoUpdate: the unique
      // index includes actor_id, which is NULL here (no specific
      // users row to point at) — Postgres never treats two NULLs as
      // conflicting, so ON CONFLICT would silently no-op and leave
      // duplicate rows behind on a second reaction.
      await db
        .delete(messageReactions)
        .where(and(eq(messageReactions.messageId, target.id), eq(messageReactions.actorType, actorType)));
      if (parsed.reactionEmoji) {
        await db.insert(messageReactions).values({
          messageId: target.id,
          conversationId: conversation.id,
          actorType,
          actorId: null,
          emoji: parsed.reactionEmoji,
        });
      }
    } catch (err) {
      console.error("[uazapi webhook] reaction upsert/delete error:", err);
    }
    return;
  }

  // Someone revoked ("delete for everyone") a message on their own
  // phone — the customer, or the connected number's own phone acting
  // outside the CRM (fromMe). Either way, mark it deleted here too
  // rather than removing the row, so the bubble can show a "Mensagem
  // apagada" placeholder in its place instead of just vanishing.
  if (parsed.type === "revoke") {
    if (!parsed.revokeTargetId) return;
    await db
      .update(messages)
      .set({ deletedAt: new Date() })
      .where(and(eq(messages.conversationId, conversation.id), eq(messages.messageId, parsed.revokeTargetId)))
      .catch((err) => console.error("[uazapi webhook] revoke update error:", err));
    return;
  }

  // Satisfaction-survey reply: a plain "1".."5" (optionally with a
  // little surrounding text/emoji, e.g. "Nota 5!" or "5 estrelas") on
  // a conversation the close-flow marked as awaiting one (see
  // conversations.survey_requested_at). Recorded once per
  // conversation (idx_csat_responses_conversation) — a later message
  // never overwrites it, and surveyRequestedAt is cleared right after
  // so it can't be re-matched if this same contact writes again later.
  if (!parsed.fromMe && !contact.isGroup && conversation.surveyRequestedAt && parsed.type === "text") {
    const ratingMatch = (parsed.text ?? "").trim().match(/^[^\d]{0,15}([1-5])[^\d]{0,15}$/);
    if (ratingMatch) {
      try {
        await db.insert(csatResponses).values({
          accountId,
          conversationId: conversation.id,
          contactId: contact.id,
          agentId: conversation.assignedAgentId,
          rating: Number(ratingMatch[1]),
          rawText: parsed.text ?? "",
        });
        await db
          .update(conversations)
          .set({ surveyRequestedAt: null })
          .where(eq(conversations.id, conversation.id));
      } catch (err) {
        console.error("[uazapi webhook] csat response insert error:", err);
      }
    }
  }

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
        } else {
          console.error("[uazapi webhook] profile picture resolved but failed to save via saveInboundMedia, url:", picResult.data.url);
        }
      } else {
        console.error("[uazapi webhook] profile picture fetch returned no url:", picResult.error);
        await db
          .insert(webhookDebugLog)
          .values({ source: "uazapi-avatar", body: (picResult.raw ?? { error: picResult.error }) as object })
          .catch(() => {});
      }
    } catch (err) {
      console.error("[uazapi webhook] profile picture fetch failed:", err);
    }
  }

  const contentText = parsed.type === "location" ? parsed.text : (parsed.text ?? null);

  // Re-host inbound media through our own authenticated /api/files/<id>
  // instead of trusting UAZAPI's URL to stay fetchable from the
  // browser (auth/expiry) — see src/lib/storage/server-files.ts.
  //
  // WhatsApp media is end-to-end encrypted, so whatever URL/base64 a
  // webhook payload happens to embed directly isn't reliably
  // fetchable/decryptable on its own — UAZAPI's `message/download`
  // endpoint (see uazapi-client.ts `downloadMedia`) is the confirmed
  // way to get a real, usable file for a given message id (same
  // operation a separately-built, working n8n flow against this
  // account's UAZAPI server relies on). Called first for every media
  // type; the webhook-embedded mediaUrl/mediaBase64 only kick in as a
  // fallback if that call fails for some reason.
  const isMediaType =
    parsed.type === "image" || parsed.type === "audio" || parsed.type === "video" || parsed.type === "document";
  let mediaUrl = parsed.mediaUrl;
  let mediaBase64 = parsed.mediaBase64;
  let mediaMimeType = parsed.mimeType;

  if (isMediaType && parsed.externalId && row.uazapiUrl && row.uazapiToken) {
    const dl = await downloadMedia({ baseUrl: row.uazapiUrl, token: decrypt(row.uazapiToken) }, parsed.externalId);
    if (dl.ok && dl.data) {
      mediaUrl = dl.data.fileURL;
      mediaBase64 = null;
      if (dl.data.mimeType) mediaMimeType = dl.data.mimeType;
    } else {
      console.error(
        "[uazapi webhook] message/download failed, falling back to webhook-embedded media:",
        dl.error,
      );
    }
  }

  if ((mediaUrl || mediaBase64) && row.uazapiUrl && row.uazapiToken) {
    mediaUrl = await saveInboundMedia({
      accountId,
      sourceUrl: mediaUrl,
      sourceBase64: mediaBase64,
      mimeType: mediaMimeType,
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
        // Every new customer message reopens the conversation as
        // "pending" — it stays closed to the attendant until someone
        // replies (see conversations/[id]/messages/route.ts, which
        // flips it back to "open" on send).
        ...(parsed.fromMe ? {} : { status: "pending" as const }),
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
  isGroup = false,
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
        isGroup,
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

/** Finds (or lazily creates) this account's system "Grupo" tag and
 *  attaches it to `contactId`. Idempotent — safe to call more than
 *  once for the same contact. */
async function tagAsGroup(accountId: string, contactId: string): Promise<void> {
  const [existingTag] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.accountId, accountId), eq(tags.isSystem, true)))
    .limit(1);

  const tagId =
    existingTag?.id ??
    (
      await db
        .insert(tags)
        .values({ accountId, name: "Grupo", color: "#6b7280", isSystem: true })
        .returning({ id: tags.id })
    )[0]?.id;

  if (!tagId) return;

  await db
    .insert(contactTags)
    .values({ contactId, tagId })
    .onConflictDoNothing();
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
      .values({ accountId, userId: ownerUserId, contactId, status: "pending" })
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
