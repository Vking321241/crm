// ============================================================
// GET  /api/internal-chat/channels/[id]/messages — full history,
//      oldest first. Also bumps the caller's `last_read_at` so the
//      channel list's unread badge clears — mirrors how opening an
//      inbox thread resets its unread_count.
// POST /api/internal-chat/channels/[id]/messages — send a team-only
//      message. Body: { contentText }.
// Both require membership in the channel AND the "internal_chat"
// permission module.
// ============================================================

import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";

import { requireModule, toErrorResponse } from "@/lib/auth/account";
import { internalChannelMembers, internalMessages } from "@/db/schema";
import { toApiInternalMessage } from "../../../_shared";

async function requireMembership(
  ctx: Awaited<ReturnType<typeof requireModule>>,
  channelId: string,
) {
  const [membership] = await ctx.db
    .select()
    .from(internalChannelMembers)
    .where(
      and(
        eq(internalChannelMembers.channelId, channelId),
        eq(internalChannelMembers.userId, ctx.userId),
      ),
    )
    .limit(1);
  return membership ?? null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireModule("internal_chat");
    const { id } = await params;

    const membership = await requireMembership(ctx, id);
    if (!membership) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const rows = await ctx.db
      .select()
      .from(internalMessages)
      .where(eq(internalMessages.channelId, id))
      .orderBy(asc(internalMessages.createdAt));

    await ctx.db
      .update(internalChannelMembers)
      .set({ lastReadAt: new Date() })
      .where(eq(internalChannelMembers.id, membership.id));

    return NextResponse.json({ messages: rows.map(toApiInternalMessage) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireModule("internal_chat");
    const { id } = await params;

    const membership = await requireMembership(ctx, id);
    if (!membership) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as { contentText?: unknown } | null;
    const contentText = typeof body?.contentText === "string" ? body.contentText.trim() : "";
    if (!contentText) {
      return NextResponse.json({ error: "'contentText' is required" }, { status: 400 });
    }

    const [row] = await ctx.db
      .insert(internalMessages)
      .values({ channelId: id, senderId: ctx.userId, contentText })
      .returning();

    await ctx.db
      .update(internalChannelMembers)
      .set({ lastReadAt: new Date() })
      .where(eq(internalChannelMembers.id, membership.id));

    return NextResponse.json({ message: toApiInternalMessage(row) }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
