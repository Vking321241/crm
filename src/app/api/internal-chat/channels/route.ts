// ============================================================
// GET  /api/internal-chat/channels — every channel the caller is a
//      member of, with the last message preview and unread count
//      (derived from internal_channel_members.last_read_at, mirroring
//      the polling-based unread pattern used elsewhere in the app —
//      no realtime layer).
// POST /api/internal-chat/channels — create a channel. Body:
//      { name } for a group, or { targetUserId } for a 1:1 DM
//      (reuses an existing DM between the same two people instead of
//      creating a duplicate).
// Gated behind the "internal_chat" permission module.
// ============================================================

import { NextResponse } from "next/server";
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";

import { requireModule, toErrorResponse } from "@/lib/auth/account";
import {
  internalChannels,
  internalChannelMembers,
  internalMessages,
  users,
} from "@/db/schema";
import { toApiChannel } from "../_shared";

export async function GET() {
  try {
    const ctx = await requireModule("internal_chat");

    const memberships = await ctx.db
      .select({
        channel: internalChannels,
        lastReadAt: internalChannelMembers.lastReadAt,
      })
      .from(internalChannelMembers)
      .innerJoin(internalChannels, eq(internalChannelMembers.channelId, internalChannels.id))
      .where(eq(internalChannelMembers.userId, ctx.userId));

    const channelIds = memberships.map((m) => m.channel.id);

    const [lastMessages, otherMembers, unreadCounts] = await Promise.all([
      channelIds.length
        ? ctx.db
            .select()
            .from(internalMessages)
            .where(inArray(internalMessages.channelId, channelIds))
            .orderBy(desc(internalMessages.createdAt))
        : [],
      channelIds.length
        ? ctx.db
            .select({
              channelId: internalChannelMembers.channelId,
              userId: internalChannelMembers.userId,
              fullName: users.fullName,
            })
            .from(internalChannelMembers)
            .innerJoin(users, eq(users.id, internalChannelMembers.userId))
            .where(inArray(internalChannelMembers.channelId, channelIds))
        : [],
      channelIds.length
        ? Promise.all(
            memberships.map(async (m) => {
              const [{ value }] = await ctx.db
                .select({ value: sql<number>`count(*)::int` })
                .from(internalMessages)
                .where(
                  and(
                    eq(internalMessages.channelId, m.channel.id),
                    m.lastReadAt
                      ? gt(internalMessages.createdAt, m.lastReadAt)
                      : sql`true`,
                    // Never count the member's own messages as unread.
                    or(isNull(internalMessages.senderId), sql`${internalMessages.senderId} <> ${ctx.userId}`),
                  ),
                );
              return [m.channel.id, value] as const;
            }),
          )
        : [],
    ]);

    const lastMessageByChannel = new Map<string, (typeof lastMessages)[number]>();
    for (const m of lastMessages) {
      if (!lastMessageByChannel.has(m.channelId)) lastMessageByChannel.set(m.channelId, m);
    }
    const membersByChannel = new Map<string, { user_id: string; full_name: string }[]>();
    for (const m of otherMembers) {
      const list = membersByChannel.get(m.channelId) ?? [];
      list.push({ user_id: m.userId, full_name: m.fullName });
      membersByChannel.set(m.channelId, list);
    }
    const unreadByChannel = new Map(unreadCounts);

    const channels = memberships
      .map((m) => {
        const members = membersByChannel.get(m.channel.id) ?? [];
        const otherMember = m.channel.isDirect
          ? members.find((mm) => mm.user_id !== ctx.userId)
          : undefined;
        const lastMessage = lastMessageByChannel.get(m.channel.id);
        const lastMessagePreview =
          lastMessage?.kind === "image"
            ? "📷 Imagem"
            : lastMessage?.kind === "audio"
              ? "🎤 Áudio"
              : (lastMessage?.contentText ?? undefined);
        return {
          ...toApiChannel(m.channel),
          display_name: m.channel.isDirect ? (otherMember?.full_name ?? "Direto") : m.channel.name,
          members,
          last_message_text: lastMessagePreview,
          last_message_at: lastMessage?.createdAt ?? undefined,
          last_message_sender_id: lastMessage?.senderId ?? undefined,
          unread_count: unreadByChannel.get(m.channel.id) ?? 0,
        };
      })
      .sort((a, b) => {
        const at = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const bt = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return bt - at;
      });

    return NextResponse.json({ channels });
  } catch (err) {
    return toErrorResponse(err);
  }
}

interface CreateBody {
  name?: unknown;
  targetUserId?: unknown;
  memberIds?: unknown;
}

export async function POST(request: Request) {
  try {
    const ctx = await requireModule("internal_chat");
    const body = (await request.json().catch(() => null)) as CreateBody | null;

    const targetUserId = typeof body?.targetUserId === "string" ? body.targetUserId : null;

    if (targetUserId) {
      if (targetUserId === ctx.userId) {
        return NextResponse.json({ error: "Escolha outro colega para conversar" }, { status: 400 });
      }
      const [target] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, targetUserId), eq(users.accountId, ctx.accountId)))
        .limit(1);
      if (!target) {
        return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
      }

      // Reuse an existing DM between these two people instead of
      // creating a duplicate — find channels the caller is in that
      // are direct, then check membership overlap.
      const myDirectChannels = await ctx.db
        .select({ channelId: internalChannelMembers.channelId })
        .from(internalChannelMembers)
        .innerJoin(internalChannels, eq(internalChannels.id, internalChannelMembers.channelId))
        .where(and(eq(internalChannelMembers.userId, ctx.userId), eq(internalChannels.isDirect, true)));

      if (myDirectChannels.length > 0) {
        const existing = await ctx.db
          .select({ channelId: internalChannelMembers.channelId })
          .from(internalChannelMembers)
          .where(
            and(
              eq(internalChannelMembers.userId, targetUserId),
              inArray(
                internalChannelMembers.channelId,
                myDirectChannels.map((c) => c.channelId),
              ),
            ),
          )
          .limit(1);
        if (existing[0]) {
          const [channel] = await ctx.db
            .select()
            .from(internalChannels)
            .where(eq(internalChannels.id, existing[0].channelId))
            .limit(1);
          return NextResponse.json({ channel: toApiChannel(channel) });
        }
      }

      const [channel] = await ctx.db
        .insert(internalChannels)
        .values({ accountId: ctx.accountId, isDirect: true, createdBy: ctx.userId })
        .returning();
      await ctx.db.insert(internalChannelMembers).values([
        { channelId: channel.id, userId: ctx.userId },
        { channelId: channel.id, userId: targetUserId },
      ]);
      return NextResponse.json({ channel: toApiChannel(channel) }, { status: 201 });
    }

    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "'name' is required for a group channel" }, { status: 400 });
    }
    const memberIds = Array.isArray(body?.memberIds)
      ? body!.memberIds.filter((v): v is string => typeof v === "string")
      : [];

    const [channel] = await ctx.db
      .insert(internalChannels)
      .values({ accountId: ctx.accountId, name, isDirect: false, createdBy: ctx.userId })
      .returning();

    const uniqueMemberIds = Array.from(new Set([ctx.userId, ...memberIds]));
    await ctx.db
      .insert(internalChannelMembers)
      .values(uniqueMemberIds.map((userId) => ({ channelId: channel.id, userId })));

    return NextResponse.json({ channel: toApiChannel(channel) }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
