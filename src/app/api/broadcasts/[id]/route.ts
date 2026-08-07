// ============================================================
// GET    /api/broadcasts/[id] — broadcast detail + its recipients
//        (joined with the contact's name/phone). Any account member.
// DELETE /api/broadcasts/[id] — only allowed while status = 'draft'.
//        Agent+.
// ============================================================

import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { broadcasts, broadcastRecipients, contacts } from "@/db/schema";
import type { Db } from "@/db/client";

async function loadBroadcast(db: Db, accountId: string, id: string) {
  const [row] = await db
    .select()
    .from(broadcasts)
    .where(and(eq(broadcasts.id, id), eq(broadcasts.accountId, accountId)))
    .limit(1);
  return row ?? null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ctx = await getCurrentAccount();

    const broadcast = await loadBroadcast(ctx.db, ctx.accountId, id);
    if (!broadcast) {
      return NextResponse.json({ error: "Broadcast not found" }, { status: 404 });
    }

    const recipients = await ctx.db
      .select({
        id: broadcastRecipients.id,
        broadcastId: broadcastRecipients.broadcastId,
        contactId: broadcastRecipients.contactId,
        status: broadcastRecipients.status,
        whatsappMessageId: broadcastRecipients.whatsappMessageId,
        sentAt: broadcastRecipients.sentAt,
        deliveredAt: broadcastRecipients.deliveredAt,
        readAt: broadcastRecipients.readAt,
        repliedAt: broadcastRecipients.repliedAt,
        errorMessage: broadcastRecipients.errorMessage,
        createdAt: broadcastRecipients.createdAt,
        contactName: contacts.name,
        contactPhone: contacts.phone,
      })
      .from(broadcastRecipients)
      .innerJoin(contacts, eq(contacts.id, broadcastRecipients.contactId))
      .where(eq(broadcastRecipients.broadcastId, id))
      .orderBy(desc(broadcastRecipients.createdAt));

    return NextResponse.json({
      broadcast,
      recipients: recipients.map((r) => ({
        id: r.id,
        broadcastId: r.broadcastId,
        contactId: r.contactId,
        status: r.status,
        whatsappMessageId: r.whatsappMessageId,
        sentAt: r.sentAt,
        deliveredAt: r.deliveredAt,
        readAt: r.readAt,
        repliedAt: r.repliedAt,
        errorMessage: r.errorMessage,
        createdAt: r.createdAt,
        contact: { name: r.contactName, phone: r.contactPhone },
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ctx = await requireRole("agent");

    const broadcast = await loadBroadcast(ctx.db, ctx.accountId, id);
    if (!broadcast) {
      return NextResponse.json({ error: "Broadcast not found" }, { status: 404 });
    }
    if (broadcast.status !== "draft") {
      return NextResponse.json(
        { error: "Only draft broadcasts can be deleted" },
        { status: 400 },
      );
    }

    // broadcast_recipients cascades on broadcasts.id — a single delete
    // is sufficient (there's nothing to send yet on a draft anyway).
    await ctx.db.delete(broadcasts).where(eq(broadcasts.id, id));

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
