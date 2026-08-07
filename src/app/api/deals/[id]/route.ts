// ============================================================
// PATCH  /api/deals/[id] — update a deal. Also the endpoint the
//        kanban's drag-and-drop uses to persist a card being
//        dropped on another stage (`{ stageId: "<new stage>" }`).
// DELETE /api/deals/[id]
//
// Both agent+ (operational data). Every query is scoped by
// `ctx.accountId` — there is no RLS backing this table.
// ============================================================

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import type { Db } from "@/db/client";
import { contacts, dealStatusEnum, deals, pipelines, pipelineStages, users } from "@/db/schema";

const MAX_TITLE_LEN = 200;
const MAX_NOTES_LEN = 5000;
const MAX_CURRENCY_LEN = 10;
const DEAL_STATUSES = dealStatusEnum.enumValues;

async function loadDeal(db: Db, accountId: string, id: string) {
  const [deal] = await db
    .select()
    .from(deals)
    .where(and(eq(deals.id, id), eq(deals.accountId, accountId)))
    .limit(1);
  return deal ?? null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;

    const existing = await loadDeal(ctx.db, ctx.accountId, id);
    if (!existing) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as
      | {
          title?: unknown;
          stageId?: unknown;
          pipelineId?: unknown;
          contactId?: unknown;
          conversationId?: unknown;
          value?: unknown;
          currency?: unknown;
          notes?: unknown;
          expectedCloseDate?: unknown;
          status?: unknown;
          assignedTo?: unknown;
        }
      | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const update: Partial<typeof deals.$inferInsert> = { updatedAt: new Date() };

    if (typeof body.title === "string") {
      const title = body.title.trim();
      if (!title) {
        return NextResponse.json({ error: "'title' cannot be empty" }, { status: 400 });
      }
      if (title.length > MAX_TITLE_LEN) {
        return NextResponse.json(
          { error: `'title' must be ${MAX_TITLE_LEN} characters or fewer` },
          { status: 400 },
        );
      }
      update.title = title;
    }

    // Moving stage: the new stage determines the pipeline too (a
    // stage belongs to exactly one pipeline), same rule as create.
    // This is the path the kanban drag-and-drop hits.
    if (typeof body.stageId === "string" && body.stageId) {
      const [stageRow] = await ctx.db
        .select({ stage: pipelineStages, pipeline: pipelines })
        .from(pipelineStages)
        .innerJoin(pipelines, eq(pipelines.id, pipelineStages.pipelineId))
        .where(and(eq(pipelineStages.id, body.stageId), eq(pipelines.accountId, ctx.accountId)))
        .limit(1);
      if (!stageRow) {
        return NextResponse.json({ error: "Stage not found" }, { status: 404 });
      }
      update.stageId = stageRow.stage.id;
      update.pipelineId = stageRow.pipeline.id;
    }

    if (typeof body.contactId === "string") {
      if (body.contactId === "") {
        update.contactId = null;
      } else {
        const [contact] = await ctx.db
          .select({ id: contacts.id })
          .from(contacts)
          .where(and(eq(contacts.id, body.contactId), eq(contacts.accountId, ctx.accountId)))
          .limit(1);
        if (!contact) {
          return NextResponse.json({ error: "Contact not found" }, { status: 404 });
        }
        update.contactId = contact.id;
      }
    }

    if (typeof body.assignedTo === "string") {
      if (body.assignedTo === "") {
        update.assignedTo = null;
      } else {
        const [member] = await ctx.db
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, body.assignedTo), eq(users.accountId, ctx.accountId)))
          .limit(1);
        if (!member) {
          return NextResponse.json({ error: "Assignee not found" }, { status: 404 });
        }
        update.assignedTo = member.id;
      }
    }

    if (typeof body.conversationId === "string") {
      update.conversationId = body.conversationId || null;
    }

    if (body.value !== undefined) {
      const raw = body.value;
      const num =
        typeof raw === "number" && Number.isFinite(raw)
          ? raw
          : typeof raw === "string" && raw.trim() && Number.isFinite(Number(raw))
            ? Number(raw)
            : null;
      if (num === null) {
        return NextResponse.json({ error: "'value' must be a number" }, { status: 400 });
      }
      update.value = String(num);
    }

    if (typeof body.currency === "string" && body.currency.trim()) {
      update.currency = body.currency.trim().slice(0, MAX_CURRENCY_LEN).toUpperCase();
    }

    if (typeof body.notes === "string") {
      update.notes = body.notes.trim().slice(0, MAX_NOTES_LEN) || null;
    }

    if (typeof body.expectedCloseDate === "string") {
      update.expectedCloseDate = body.expectedCloseDate.trim() || null;
    }

    if (typeof body.status === "string") {
      if (!DEAL_STATUSES.includes(body.status as (typeof DEAL_STATUSES)[number])) {
        return NextResponse.json(
          { error: `'status' must be one of ${DEAL_STATUSES.join(", ")}` },
          { status: 400 },
        );
      }
      update.status = body.status as (typeof DEAL_STATUSES)[number];
    }

    const [updated] = await ctx.db
      .update(deals)
      .set(update)
      .where(and(eq(deals.id, id), eq(deals.accountId, ctx.accountId)))
      .returning();

    return NextResponse.json({ deal: updated ?? existing });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;

    const existing = await loadDeal(ctx.db, ctx.accountId, id);
    if (!existing) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    await ctx.db.delete(deals).where(and(eq(deals.id, id), eq(deals.accountId, ctx.accountId)));

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
