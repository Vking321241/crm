// ============================================================
// GET  /api/deals — list deals for the account. Supports
//        `?pipelineId=`, `?stageId=`, `?contactId=` filters (any
//        combination, all ANDed). `contactId` in particular is
//        relied on by the contact detail page (a different area
//        of the app) to show "deals for this contact" — its
//        response shape (id, title, value, currency, status,
//        stageId, pipelineId, contactId, ...) is a contract other
//        code depends on, not just this page's kanban.
// POST /api/deals — create a deal. Agent+ (operational data, see
//        AGENTS.md / src/lib/auth/roles.ts canSendMessages doc).
//
// Every query is scoped by `ctx.accountId` — there is no RLS
// backing this table.
// ============================================================

import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";

import { getCurrentAccount, requireRole, toErrorResponse } from "@/lib/auth/account";
import { contacts, deals, pipelines, pipelineStages, users } from "@/db/schema";

const MAX_TITLE_LEN = 200;
const MAX_NOTES_LEN = 5000;
const MAX_CURRENCY_LEN = 10;
const DEFAULT_CURRENCY = "USD";

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const url = new URL(request.url);

    const pipelineId = url.searchParams.get("pipelineId");
    const stageId = url.searchParams.get("stageId");
    const contactId = url.searchParams.get("contactId");

    const conditions = [eq(deals.accountId, ctx.accountId)];
    if (pipelineId) conditions.push(eq(deals.pipelineId, pipelineId));
    if (stageId) conditions.push(eq(deals.stageId, stageId));
    if (contactId) conditions.push(eq(deals.contactId, contactId));

    const rows = await ctx.db
      .select()
      .from(deals)
      .where(and(...conditions))
      .orderBy(desc(deals.createdAt));

    const contactIds = [...new Set(rows.map((d) => d.contactId).filter((v): v is string => !!v))];
    const assigneeIds = [...new Set(rows.map((d) => d.assignedTo).filter((v): v is string => !!v))];

    const [contactRows, assigneeRows] = await Promise.all([
      contactIds.length > 0
        ? ctx.db
            .select({ id: contacts.id, name: contacts.name, phone: contacts.phone })
            .from(contacts)
            .where(and(eq(contacts.accountId, ctx.accountId), inArray(contacts.id, contactIds)))
        : Promise.resolve([]),
      assigneeIds.length > 0
        ? ctx.db
            .select({ id: users.id, fullName: users.fullName, email: users.email })
            .from(users)
            .where(and(eq(users.accountId, ctx.accountId), inArray(users.id, assigneeIds)))
        : Promise.resolve([]),
    ]);

    const contactById = new Map(contactRows.map((c) => [c.id, c]));
    const assigneeById = new Map(assigneeRows.map((a) => [a.id, a]));

    const result = rows.map((d) => ({
      ...d,
      contact: d.contactId ? (contactById.get(d.contactId) ?? null) : null,
      assignee: d.assignedTo ? (assigneeById.get(d.assignedTo) ?? null) : null,
    }));

    return NextResponse.json({ deals: result });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");

    const body = (await request.json().catch(() => null)) as
      | {
          title?: unknown;
          pipelineId?: unknown;
          stageId?: unknown;
          contactId?: unknown;
          conversationId?: unknown;
          value?: unknown;
          currency?: unknown;
          notes?: unknown;
          expectedCloseDate?: unknown;
          assignedTo?: unknown;
        }
      | null;

    const title = typeof body?.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json({ error: "'title' is required" }, { status: 400 });
    }
    if (title.length > MAX_TITLE_LEN) {
      return NextResponse.json(
        { error: `'title' must be ${MAX_TITLE_LEN} characters or fewer` },
        { status: 400 },
      );
    }

    const stageId = typeof body?.stageId === "string" ? body.stageId : "";
    if (!stageId) {
      return NextResponse.json({ error: "'stageId' is required" }, { status: 400 });
    }

    // The deal's pipeline is derived from the stage, not trusted
    // from the client — a stage can only ever belong to one
    // pipeline, so this both validates ownership and keeps
    // `deals.pipeline_id` / `deals.stage_id` always consistent.
    const [stageRow] = await ctx.db
      .select({ stage: pipelineStages, pipeline: pipelines })
      .from(pipelineStages)
      .innerJoin(pipelines, eq(pipelines.id, pipelineStages.pipelineId))
      .where(and(eq(pipelineStages.id, stageId), eq(pipelines.accountId, ctx.accountId)))
      .limit(1);
    if (!stageRow) {
      return NextResponse.json({ error: "Stage not found" }, { status: 404 });
    }
    if (
      typeof body?.pipelineId === "string" &&
      body.pipelineId &&
      body.pipelineId !== stageRow.pipeline.id
    ) {
      return NextResponse.json(
        { error: "'stageId' does not belong to 'pipelineId'" },
        { status: 400 },
      );
    }

    let contactId: string | null = null;
    if (typeof body?.contactId === "string" && body.contactId) {
      const [contact] = await ctx.db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.id, body.contactId), eq(contacts.accountId, ctx.accountId)))
        .limit(1);
      if (!contact) {
        return NextResponse.json({ error: "Contact not found" }, { status: 404 });
      }
      contactId = contact.id;
    }

    let assignedTo: string | null = null;
    if (typeof body?.assignedTo === "string" && body.assignedTo) {
      const [member] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, body.assignedTo), eq(users.accountId, ctx.accountId)))
        .limit(1);
      if (!member) {
        return NextResponse.json({ error: "Assignee not found" }, { status: 404 });
      }
      assignedTo = member.id;
    }

    const valueRaw = body?.value;
    const value =
      typeof valueRaw === "number" && Number.isFinite(valueRaw)
        ? valueRaw
        : typeof valueRaw === "string" && valueRaw.trim() && Number.isFinite(Number(valueRaw))
          ? Number(valueRaw)
          : 0;

    const currency =
      typeof body?.currency === "string" && body.currency.trim()
        ? body.currency.trim().slice(0, MAX_CURRENCY_LEN).toUpperCase()
        : DEFAULT_CURRENCY;

    const notes = typeof body?.notes === "string" ? body.notes.trim().slice(0, MAX_NOTES_LEN) : "";

    const expectedCloseDate =
      typeof body?.expectedCloseDate === "string" && body.expectedCloseDate.trim()
        ? body.expectedCloseDate.trim()
        : null;

    const conversationId =
      typeof body?.conversationId === "string" && body.conversationId ? body.conversationId : null;

    const [deal] = await ctx.db
      .insert(deals)
      .values({
        accountId: ctx.accountId,
        userId: ctx.userId,
        pipelineId: stageRow.pipeline.id,
        stageId: stageRow.stage.id,
        contactId,
        conversationId,
        title,
        value: String(value),
        currency,
        notes: notes || null,
        expectedCloseDate,
        assignedTo,
      })
      .returning();

    return NextResponse.json({ deal }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
