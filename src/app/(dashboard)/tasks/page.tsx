'use client';

// ============================================================
// Central de Tarefas — account-wide view of every scheduled task
// created from the inbox sidebar (see ConversationTasks), grouped
// into Hoje / Atrasadas / Concluídas. Clicking a task jumps back into
// the conversation it hangs off of.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { format, isToday } from 'date-fns';
import { toast } from 'sonner';
import { CalendarClock, Check, Loader2 } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent } from '@/components/ui/card';

interface AccountTask {
  id: string;
  conversation_id: string;
  contact_name: string;
  note: string;
  due_at: string;
  status: 'pending' | 'done';
  is_overdue: boolean;
}

const POLL_MS = 15000;

export default function TasksPage() {
  const { hasPermission, profileLoading } = useAuth();
  const [tasks, setTasks] = useState<AccountTask[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setLoading(true);
    try {
      const res = await fetch('/api/tasks', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setTasks((data.tasks as AccountTask[]) ?? []);
      }
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
    const timer = setInterval(() => void load(false), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function toggleDone(task: AccountTask) {
    const nextStatus = task.status === 'done' ? 'pending' : 'done';
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)));
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (!res.ok) {
      toast.error('Falha ao atualizar tarefa');
      void load(false);
    }
  }

  const groups = useMemo(() => {
    const today: AccountTask[] = [];
    const overdue: AccountTask[] = [];
    const done: AccountTask[] = [];
    for (const task of tasks) {
      if (task.status === 'done') {
        done.push(task);
      } else if (task.is_overdue) {
        overdue.push(task);
      } else if (isToday(new Date(task.due_at))) {
        today.push(task);
      }
    }
    return { today, overdue, done };
  }, [tasks]);

  if (!profileLoading && !hasPermission('tasks')) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Você não tem acesso à Central de Tarefas. Peça a um administrador para liberar em
          Configurações → Permissões.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <CalendarClock className="size-5 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Central de Tarefas</h1>
      </div>

      {loading ? (
        <div className="mt-8 flex justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <TaskColumn
            title="Hoje"
            tasks={groups.today}
            emptyLabel="Nada agendado para hoje"
            onToggle={toggleDone}
          />
          <TaskColumn
            title="Atrasadas"
            tasks={groups.overdue}
            emptyLabel="Nenhuma tarefa atrasada"
            accent="text-red-400"
            onToggle={toggleDone}
          />
          <TaskColumn
            title="Concluídas"
            tasks={groups.done}
            emptyLabel="Nenhuma tarefa concluída ainda"
            onToggle={toggleDone}
          />
        </div>
      )}
    </div>
  );
}

function TaskColumn({
  title,
  tasks,
  emptyLabel,
  accent,
  onToggle,
}: {
  title: string;
  tasks: AccountTask[];
  emptyLabel: string;
  accent?: string;
  onToggle: (task: AccountTask) => void;
}) {
  return (
    <div>
      <h2 className={`mb-2 text-sm font-semibold ${accent ?? 'text-foreground'}`}>
        {title} <span className="text-muted-foreground">({tasks.length})</span>
      </h2>
      <div className="space-y-2">
        {tasks.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
            {emptyLabel}
          </p>
        ) : (
          tasks.map((task) => (
            <Card key={task.id}>
              <CardContent className="flex items-start gap-2.5 p-3">
                <button
                  type="button"
                  onClick={() => onToggle(task)}
                  aria-label={task.status === 'done' ? 'Marcar como pendente' : 'Marcar como concluída'}
                  className={
                    task.status === 'done'
                      ? 'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground'
                      : 'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-muted-foreground/40'
                  }
                >
                  {task.status === 'done' && <Check className="size-3" />}
                </button>
                <div className="min-w-0 flex-1">
                  <p
                    className={
                      task.status === 'done'
                        ? 'text-sm text-muted-foreground line-through'
                        : 'text-sm text-foreground'
                    }
                  >
                    {task.note}
                  </p>
                  <Link
                    href={`/inbox?c=${task.conversation_id}`}
                    className="mt-1 block truncate text-xs text-primary hover:underline"
                  >
                    {task.contact_name}
                  </Link>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {format(new Date(task.due_at), 'dd/MM/yyyy HH:mm')}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
