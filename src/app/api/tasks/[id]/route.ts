// ============================================================
// PATCH  /api/tasks/[id] — mark done/pending, or edit note/dueAt.
// DELETE /api/tasks/[id] — remove a scheduled task.
// Both agent+.
// ============================================================

import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { conversationTasks } from "@/db/schema";
import { toApiTask } from "../_shared";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole("agent");
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as
      | { status?: unknown; note?: unknown; dueAt?: unknown }
      | null;

    const update: Partial<typeof conversationTasks.$inferInsert> = {};

    if (body?.status === "done" || body?.status === "pending") {
      update.status = body.status;
      update.completedAt = body.status === "done" ? new Date() : null;
    }
    if (typeof body?.note === "string" && body.note.trim()) {
      update.note = body.note.trim();
    }
    if (typeof body?.dueAt === "string") {
      const dueAt = new Date(body.dueAt);
      if (!Number.isNaN(dueAt.getTime())) update.dueAt = dueAt;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }
    update.updatedAt = new Date();

    const [row] = await ctx.db
      .update(conversationTasks)
      .set(update)
      .where(and(eq(conversationTasks.id, id), eq(conversationTasks.accountId, ctx.accountId)))
      .returning();

    if (!row) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    return NextResponse.json({ task: toApiTask(row) });
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

    await ctx.db
      .delete(conversationTasks)
      .where(and(eq(conversationTasks.id, id), eq(conversationTasks.accountId, ctx.accountId)));

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
