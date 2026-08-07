// ============================================================
// GET   /api/conversations/[id]   — detail (any member).
// PATCH /api/conversations/[id]   — update status / assignment
//                                    (agent+).
//
// Replaces the old `notify_conversation_assigned` Postgres trigger
// (which depended on `auth.uid()`, gone with Supabase Auth): when
// `assigned_agent_id` changes to a non-null value different from
// the caller, we insert a `notifications` row here instead. A
// failure to write the notification never fails the assignment
// itself — it's only logged.
// ============================================================

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  conversations,
  contacts,
  conversationStatusEnum,
  notifications,
  users,
} from "@/db/schema";
import { toApiConversation, loadOwnedConversation } from "../_shared";

const VALID_STATUSES = conversationStatusEnum.enumValues;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("viewer");
    const { id } = await params;

    const [row] = await ctx.db
      .select({ conversation: conversations, contact: contacts })
      .from(conversations)
      .innerJoin(contacts, eq(conversations.contactId, contacts.id))
      .where(and(eq(conversations.id, id), eq(conversations.accountId, ctx.accountId)))
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    return NextResponse.json({ conversation: toApiConversation(row.conversation, row.contact) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;

    const existing = await loadOwnedConversation(ctx.db, ctx.accountId, id);
    if (!existing) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as
      | { status?: unknown; assigned_agent_id?: unknown }
      | null;
    if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

    const update: Partial<typeof conversations.$inferInsert> = {};

    if ("status" in body) {
      if (!(VALID_STATUSES as readonly string[]).includes(body.status as string)) {
        return NextResponse.json(
          { error: `status must be one of ${VALID_STATUSES.join(", ")}` },
          { status: 400 },
        );
      }
      update.status = body.status as (typeof VALID_STATUSES)[number];
    }

    let assignmentChanged = false;
    if ("assigned_agent_id" in body) {
      const next = body.assigned_agent_id;
      if (next !== null && typeof next !== "string") {
        return NextResponse.json(
          { error: "assigned_agent_id must be a string or null" },
          { status: 400 },
        );
      }
      update.assignedAgentId = next;
      assignmentChanged = next !== null && next !== existing.assignedAgentId;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ conversation: toApiConversation(existing) });
    }

    update.updatedAt = new Date();

    const [updated] = await ctx.db
      .update(conversations)
      .set(update)
      .where(and(eq(conversations.id, id), eq(conversations.accountId, ctx.accountId)))
      .returning();

    // Fire-and-forget-ish: assignment changed to a different agent than
    // the caller → notify them. Never let a notification failure fail
    // the assignment itself.
    if (assignmentChanged && update.assignedAgentId && update.assignedAgentId !== ctx.userId) {
      try {
        const [contactRow] = await ctx.db
          .select()
          .from(contacts)
          .where(eq(contacts.id, existing.contactId))
          .limit(1);
        const [actor] = await ctx.db
          .select({ fullName: users.fullName })
          .from(users)
          .where(eq(users.id, ctx.userId))
          .limit(1);

        const contactLabel = contactRow?.name || contactRow?.phone || "a contact";
        const actorName = actor?.fullName ?? "Someone";

        await ctx.db.insert(notifications).values({
          accountId: ctx.accountId,
          userId: update.assignedAgentId,
          type: "conversation_assigned",
          conversationId: id,
          contactId: existing.contactId,
          actorUserId: ctx.userId,
          title: "Conversation assigned to you",
          body: `${actorName} assigned you the conversation with ${contactLabel}`,
        });
      } catch (err) {
        console.error("[PATCH /api/conversations/[id]] notification insert failed:", err);
      }
    }

    const [contactRow] = await ctx.db
      .select()
      .from(contacts)
      .where(eq(contacts.id, updated.contactId))
      .limit(1);

    return NextResponse.json({ conversation: toApiConversation(updated, contactRow) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
