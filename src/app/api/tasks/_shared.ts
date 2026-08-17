import { conversationTasks } from "@/db/schema";

type TaskRow = typeof conversationTasks.$inferSelect;

export function toApiTask(row: TaskRow) {
  return {
    id: row.id,
    account_id: row.accountId,
    conversation_id: row.conversationId,
    created_by: row.createdBy ?? undefined,
    assigned_to: row.assignedTo ?? undefined,
    note: row.note,
    due_at: row.dueAt,
    send_as_message: row.sendAsMessage,
    status: row.status,
    completed_at: row.completedAt ?? undefined,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}
