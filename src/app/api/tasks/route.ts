// ============================================================
// GET /api/tasks — account-wide task list for the standalone Central
// de Tarefas (Hoje / Atrasadas / Concluídas), joined with the
// contact/conversation each task hangs off of so the UI can deep-link
// back into the inbox. Any member can read.
// ============================================================

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { conversationTasks, conversations, contacts } from "@/db/schema";

export async function GET() {
  try {
    const ctx = await requireRole("agent");

    const rows = await ctx.db
      .select({
        task: conversationTasks,
        conversationId: conversations.id,
        contactName: contacts.name,
        contactPhone: contacts.phone,
      })
      .from(conversationTasks)
      .innerJoin(conversations, eq(conversationTasks.conversationId, conversations.id))
      .innerJoin(contacts, eq(conversations.contactId, contacts.id))
      .where(eq(conversationTasks.accountId, ctx.accountId));

    const now = Date.now();
    const tasks = rows.map(({ task, conversationId, contactName, contactPhone }) => ({
      id: task.id,
      conversation_id: conversationId,
      contact_name: contactName || contactPhone,
      created_by: task.createdBy ?? undefined,
      assigned_to: task.assignedTo ?? undefined,
      note: task.note,
      due_at: task.dueAt,
      status: task.status,
      completed_at: task.completedAt ?? undefined,
      send_as_message: task.sendAsMessage,
      is_overdue: task.status === "pending" && new Date(task.dueAt).getTime() < now,
      created_at: task.createdAt,
    }));

    return NextResponse.json({ tasks });
  } catch (err) {
    return toErrorResponse(err);
  }
}
