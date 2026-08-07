// ============================================================
// POST /api/broadcasts/[id]/send — resolve the audience, send via
// UAZAPI, persist per-recipient results. Agent+.
//
// The account's UAZAPI instance must be connected (see
// src/lib/whatsapp/instance-context.ts) — no instance / not
// 'connected' flips the broadcast straight to 'failed' with no sends
// attempted.
//
// Sending N messages is slow, so the HTTP response returns as soon as
// the broadcast is flipped to 'sending' and the audience is resolved;
// the actual per-recipient sends run in a detached background task
// (fire-and-forget — this app runs as a long-lived Node process, not
// a serverless function, so the task survives past the response).
// Each send increments `broadcasts.sentCount`/`failedCount` in place
// so the detail page's polling UI shows live progress, then a final
// UPDATE sets the terminal status once every recipient is done.
// ============================================================

import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";

import { requireRole, toErrorResponse, type AccountContext } from "@/lib/auth/account";
import { broadcasts, broadcastRecipients, contacts, contactTags } from "@/db/schema";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { loadInstance, toUazapiConfig } from "@/lib/whatsapp/instance-context";
import { sendMedia, sendText, type UazapiMediaType } from "@/lib/whatsapp/uazapi-client";
import type { AudienceFilter } from "../../route";

interface AudienceContact {
  id: string;
  name: string | null;
  phone: string;
}

async function resolveAudience(
  ctx: AccountContext,
  accountId: string,
  filter: AudienceFilter,
): Promise<AudienceContact[]> {
  const tagIds = filter.tagIds ?? [];

  if (tagIds.length === 0) {
    return ctx.db
      .select({ id: contacts.id, name: contacts.name, phone: contacts.phone })
      .from(contacts)
      .where(eq(contacts.accountId, accountId));
  }

  const matched = await ctx.db
    .select({ id: contacts.id, name: contacts.name, phone: contacts.phone })
    .from(contacts)
    .innerJoin(
      contactTags,
      and(eq(contactTags.contactId, contacts.id), inArray(contactTags.tagId, tagIds)),
    )
    .where(eq(contacts.accountId, accountId))
    .groupBy(contacts.id, contacts.name, contacts.phone)
    .having(sql`count(distinct ${contactTags.tagId}) = ${tagIds.length}`);

  return matched;
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp)(\?|$)/i;
const VIDEO_EXT = /\.(mp4|mov|webm|mkv|avi)(\?|$)/i;
const AUDIO_EXT = /\.(mp3|ogg|oga|wav|m4a|aac|opus)(\?|$)/i;

function guessMediaType(url: string): UazapiMediaType {
  if (IMAGE_EXT.test(url)) return "image";
  if (VIDEO_EXT.test(url)) return "video";
  if (AUDIO_EXT.test(url)) return "audio";
  return "document";
}

/** Very small personalization pass — {{name}} / {{phone}} only. */
function personalize(text: string, contact: AudienceContact): string {
  return text
    .replaceAll("{{name}}", contact.name ?? "")
    .replaceAll("{{phone}}", contact.phone);
}

/**
 * Fire-and-forget send loop. Runs after the HTTP response for this
 * request has already been returned — errors here can only be
 * observed via the broadcast/recipient rows, never thrown back to a
 * caller.
 */
async function runBroadcast(
  ctx: AccountContext,
  broadcastId: string,
  contentText: string,
  mediaUrl: string | null,
  audience: AudienceContact[],
  cfg: { baseUrl: string; token?: string },
): Promise<void> {
  const mediaType = mediaUrl ? guessMediaType(mediaUrl) : null;

  let sentCount = 0;
  let failedCount = 0;

  for (const contact of audience) {
    const text = personalize(contentText, contact);
    let externalId: string | undefined;
    let errorMessage: string | null = null;

    if (!contact.phone) {
      errorMessage = "Contact has no phone number";
    } else if (mediaUrl && mediaType) {
      const res = await sendMedia(cfg, contact.phone, mediaType, mediaUrl, text || undefined);
      if (res.ok) {
        externalId = res.data?.externalId;
      } else {
        errorMessage = res.error ?? "Unknown error";
      }
    } else {
      const res = await sendText(cfg, contact.phone, text);
      if (res.ok) {
        externalId = res.data?.externalId;
      } else {
        errorMessage = res.error ?? "Unknown error";
      }
    }

    const ok = !errorMessage;
    if (ok) sentCount++;
    else failedCount++;

    try {
      await ctx.db.insert(broadcastRecipients).values({
        broadcastId,
        contactId: contact.id,
        status: ok ? "sent" : "failed",
        whatsappMessageId: externalId ?? null,
        sentAt: ok ? new Date() : null,
        errorMessage,
      });

      await ctx.db
        .update(broadcasts)
        .set({
          sentCount: ok ? sql`${broadcasts.sentCount} + 1` : broadcasts.sentCount,
          failedCount: ok ? broadcasts.failedCount : sql`${broadcasts.failedCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(broadcasts.id, broadcastId));
    } catch (err) {
      // A DB hiccup writing one recipient's outcome shouldn't abort
      // the rest of the broadcast — log and keep going.
      console.error("[broadcasts/send] failed to persist recipient result:", err);
    }
  }

  const finalStatus = sentCount === 0 && failedCount > 0 ? "failed" : "sent";
  await ctx.db
    .update(broadcasts)
    .set({ status: finalStatus, updatedAt: new Date() })
    .where(eq(broadcasts.id, broadcastId));
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ctx = await requireRole("agent");

    const limit = checkRateLimit(`broadcast:send:${ctx.userId}`, RATE_LIMITS.broadcast);
    if (!limit.success) return rateLimitResponse(limit);

    const [broadcast] = await ctx.db
      .select()
      .from(broadcasts)
      .where(and(eq(broadcasts.id, id), eq(broadcasts.accountId, ctx.accountId)))
      .limit(1);

    if (!broadcast) {
      return NextResponse.json({ error: "Broadcast not found" }, { status: 404 });
    }
    if (broadcast.status !== "draft" && broadcast.status !== "failed") {
      return NextResponse.json(
        { error: `Broadcast is already '${broadcast.status}'` },
        { status: 400 },
      );
    }

    const instance = await loadInstance(ctx, ctx.accountId);
    if (!instance || instance.status !== "connected") {
      await ctx.db
        .update(broadcasts)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(broadcasts.id, id));
      return NextResponse.json(
        { error: "WhatsApp instance is not connected. Connect it in Settings before sending." },
        { status: 400 },
      );
    }

    const audienceFilter: AudienceFilter =
      broadcast.audienceFilter && typeof broadcast.audienceFilter === "object"
        ? (broadcast.audienceFilter as AudienceFilter)
        : {};
    const audience = await resolveAudience(ctx, ctx.accountId, audienceFilter);

    if (audience.length === 0) {
      return NextResponse.json(
        { error: "No contacts match this broadcast's audience" },
        { status: 400 },
      );
    }

    await ctx.db
      .update(broadcasts)
      .set({
        status: "sending",
        totalRecipients: audience.length,
        sentCount: 0,
        failedCount: 0,
        updatedAt: new Date(),
      })
      .where(eq(broadcasts.id, id));

    const cfg = toUazapiConfig(instance);

    // Fire-and-forget: don't block the response on N sequential sends.
    void runBroadcast(ctx, id, broadcast.contentText, broadcast.mediaUrl, audience, cfg).catch(
      (err) => {
        console.error("[broadcasts/send] background send loop crashed:", err);
      },
    );

    return NextResponse.json({
      ok: true,
      status: "sending",
      totalRecipients: audience.length,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
