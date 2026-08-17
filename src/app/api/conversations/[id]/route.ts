// ============================================================
// GET   /api/conversations/[id]   — detail (any member).
// PATCH /api/conversations/[id]   — update status / assignment /
//                                    acknowledgment / manual pause
//                                    (agent+).
//
// Replaces the old `notify_conversation_assigned` Postgres trigger
// (which depended on `auth.uid()`, gone with Supabase Auth): when
// `assigned_agent_id` changes to a non-null value different from
// the caller, we insert a `notifications` row here instead. A
// failure to write the notification never fails the assignment
// itself — it's only logged.
//
// Transfers (agent reassignment or department change) also write a
// `conversation_transfers` audit row and flip `needs_acknowledgment`
// so the new assignee gets the "iniciar atendimento / apenas
// visualizar" pop-up the next time they open the conversation — see
// src/components/inbox/acknowledgment-modal.tsx.
// ============================================================

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  conversations,
  conversationTransfers,
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
    const ctx = await requireRole("agent");
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
      | {
          status?: unknown;
          assigned_agent_id?: unknown;
          department_id?: unknown;
          acknowledge?: unknown;
          paused?: unknown;
        }
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

    // Transferring to a department releases the current assignment
    // (unless the same request also sets assigned_agent_id) so the
    // conversation lands in that department's shared queue rather
    // than staying with whoever had it before.
    let departmentChanged = false;
    if ("department_id" in body) {
      const next = body.department_id;
      if (next !== null && typeof next !== "string") {
        return NextResponse.json(
          { error: "department_id must be a string or null" },
          { status: 400 },
        );
      }
      update.departmentId = next;
      departmentChanged = next !== existing.departmentId;
      if (!("assigned_agent_id" in body) && departmentChanged) {
        update.assignedAgentId = null;
      }
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

    // A hand-off (new agent, or department transfer that clears the
    // assignee) needs the receiving agent's acknowledgment before it
    // "starts" for them — see AcknowledgmentModal. Plain re-fetches
    // (same agent, no real change) never touch this flag.
    if (assignmentChanged || (departmentChanged && update.assignedAgentId === null)) {
      update.needsAcknowledgment = true;
      update.acknowledgmentReason = "transferred";
    }

    if ("acknowledge" in body && body.acknowledge === true) {
      update.needsAcknowledgment = false;
      update.acknowledgmentReason = null;
    }

    if ("paused" in body) {
      if (typeof body.paused !== "boolean") {
        return NextResponse.json({ error: "paused must be a boolean" }, { status: 400 });
      }
      update.pausedAt = body.paused ? new Date() : null;
      update.pauseReason = body.paused ? "manual" : null;
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

    // Audit trail — who handed this to whom. Never blocks the actual
    // update on failure.
    if (assignmentChanged || departmentChanged) {
      try {
        await ctx.db.insert(conversationTransfers).values({
          accountId: ctx.accountId,
          conversationId: id,
          fromAgentId: existing.assignedAgentId,
          toAgentId: updated.assignedAgentId,
          fromDepartmentId: existing.departmentId,
          toDepartmentId: updated.departmentId,
          transferredBy: ctx.userId,
        });
      } catch (err) {
        console.error("[PATCH /api/conversations/[id]] transfer log insert failed:", err);
      }
    }

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

        const contactLabel = contactRow?.name || contactRow?.phone || "um contato";
        const actorName = actor?.fullName ?? "Alguém";

        await ctx.db.insert(notifications).values({
          accountId: ctx.accountId,
          userId: update.assignedAgentId,
          type: "conversation_assigned",
          conversationId: id,
          contactId: existing.contactId,
          actorUserId: ctx.userId,
          title: "Conversa atribuída a você",
          body: `${actorName} atribuiu a você a conversa com ${contactLabel}`,
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
