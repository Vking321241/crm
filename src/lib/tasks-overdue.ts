// ============================================================
// Shared "is this task overdue" rule for both the standalone
// Central de Tarefas (GET /api/tasks) and the inbox sidebar widget
// (ConversationTasks) — kept in one place so the two never drift.
//
// A task's `due_at` and the external pinger's next actual sweep
// (see /api/cron/tasks) are never exactly simultaneous — there's
// always some gap between "became due" and "the sweep picked it
// up". Flagging a task "atrasada" the instant the clock ticks past
// due_at reads as broken even when the sweep is about to catch it
// seconds later. This grace window absorbs that gap so the red
// "Atrasada" label only appears once a task has genuinely been
// missed, not merely due.
// ============================================================

export const TASK_OVERDUE_GRACE_MINUTES = 2;

export function isTaskOverdue(dueAt: string | Date, status: string): boolean {
  if (status !== "pending") return false;
  const graceMs = TASK_OVERDUE_GRACE_MINUTES * 60_000;
  return new Date(dueAt).getTime() + graceMs < Date.now();
}
