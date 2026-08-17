// ============================================================
// GET  /api/conversations/[id]/tasks — list tasks for a conversation,
//      newest due first. Any member can read.
// POST /api/conversations/[id]/tasks — create a scheduled task.
//      Body: { note, dueAt (ISO), assignedTo?, sendAsMessage? }. Agent+.
// ============================================================

import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { conversationTasks } from "@/db/schema";
import { loadOwnedConversation } from "../../_shared";
import { toApiTask } from "../../../tasks/_shared";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;

    const existing = await loadOwnedConversation(ctx.db, ctx.accountId, id);
    if (!existing) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const rows = await ctx.db
      .select()
      .from(conversationTasks)
      .where(eq(conversationTasks.conversationId, id))
      .orderBy(asc(conversationTasks.dueAt));

    return NextResponse.json({ tasks: rows.map(toApiTask) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(
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
      | { note?: unknown; dueAt?: unknown; assignedTo?: unknown; sendAsMessage?: unknown }
      | null;

    const note = typeof body?.note === "string" ? body.note.trim() : "";
    if (!note) {
      return NextResponse.json({ error: "'note' is required" }, { status: 400 });
    }

    const dueAt = typeof body?.dueAt === "string" ? new Date(body.dueAt) : null;
    if (!dueAt || Number.isNaN(dueAt.getTime())) {
      return NextResponse.json({ error: "'dueAt' must be a valid date" }, { status: 400 });
    }

    const assignedTo = typeof body?.assignedTo === "string" ? body.assignedTo : null;
    const sendAsMessage = body?.sendAsMessage === true;

    const [row] = await ctx.db
      .insert(conversationTasks)
      .values({
        accountId: ctx.accountId,
        conversationId: id,
        createdBy: ctx.userId,
        assignedTo,
        note,
        dueAt,
        sendAsMessage,
      })
      .returning();

    return NextResponse.json({ task: toApiTask(row) }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
