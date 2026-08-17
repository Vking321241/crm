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
import { CalendarClock, Check, Loader2, Plus, Search } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ConversationOption {
  id: string;
  contact: { name: string | null; phone: string };
}

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

  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [conversationQuery, setConversationQuery] = useState('');
  const [conversationOptions, setConversationOptions] = useState<ConversationOption[]>([]);
  const [searchingConversations, setSearchingConversations] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<ConversationOption | null>(null);
  const [newNote, setNewNote] = useState('');
  const [newDueAt, setNewDueAt] = useState('');
  const [creating, setCreating] = useState(false);

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

  // Debounced conversation search — a task always hangs off a
  // conversation (see conversation_tasks.conversation_id, NOT NULL),
  // so creating one here means picking which conversation it belongs
  // to first, same as the inbox sidebar's "Agendar" flow does per-chat.
  useEffect(() => {
    if (!newTaskOpen || selectedConversation) return;
    const query = conversationQuery.trim();
    if (query.length < 2) {
      setConversationOptions([]);
      return;
    }
    setSearchingConversations(true);
    const timer = setTimeout(() => {
      fetch(`/api/conversations?search=${encodeURIComponent(query)}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((data) => setConversationOptions((data.conversations as ConversationOption[]) ?? []))
        .catch(() => setConversationOptions([]))
        .finally(() => setSearchingConversations(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [conversationQuery, newTaskOpen, selectedConversation]);

  function resetNewTaskForm() {
    setConversationQuery('');
    setConversationOptions([]);
    setSelectedConversation(null);
    setNewNote('');
    setNewDueAt('');
  }

  async function handleCreateTask() {
    if (!selectedConversation || !newNote.trim() || !newDueAt) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/conversations/${selectedConversation.id}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: newNote.trim(), dueAt: new Date(newDueAt).toISOString() }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Falha ao criar tarefa');
        return;
      }
      toast.success('Tarefa criada');
      setNewTaskOpen(false);
      resetNewTaskForm();
      await load(false);
    } finally {
      setCreating(false);
    }
  }

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
          Você não tem acesso à Central de Tarefas. Peça a um gerente para liberar em
          Configurações → Permissões.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-5 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Central de Tarefas</h1>
        </div>
        <Button
          size="sm"
          onClick={() => {
            resetNewTaskForm();
            setNewTaskOpen(true);
          }}
        >
          <Plus className="size-4" />
          Nova tarefa
        </Button>
      </div>

      <Dialog
        open={newTaskOpen}
        onOpenChange={(open) => {
          setNewTaskOpen(open);
          if (!open) resetNewTaskForm();
        }}
      >
        <DialogContent className="bg-popover border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">Nova tarefa</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Toda tarefa fica ligada a uma conversa — escolha o contato/conversa primeiro.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {selectedConversation ? (
              <div className="flex items-center justify-between rounded-md border border-border bg-muted px-3 py-2 text-sm">
                <span className="text-foreground">
                  {selectedConversation.contact.name || selectedConversation.contact.phone}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedConversation(null)}
                  className="text-xs text-primary hover:underline"
                >
                  Trocar
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    autoFocus
                    value={conversationQuery}
                    onChange={(e) => setConversationQuery(e.target.value)}
                    placeholder="Buscar por nome ou telefone..."
                    className="w-full rounded-md border border-border bg-muted py-2 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50"
                  />
                </div>
                {searchingConversations ? (
                  <div className="flex justify-center py-3">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  </div>
                ) : conversationOptions.length > 0 ? (
                  <ul className="max-h-48 space-y-1 overflow-y-auto">
                    {conversationOptions.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedConversation(c)}
                          className="w-full rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
                        >
                          {c.contact.name || c.contact.phone}
                          {c.contact.name && (
                            <span className="ml-2 text-xs text-muted-foreground">{c.contact.phone}</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : conversationQuery.trim().length >= 2 ? (
                  <p className="px-1 text-xs text-muted-foreground">Nenhuma conversa encontrada</p>
                ) : null}
              </div>
            )}

            <textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="O que precisa ser feito?"
              rows={3}
              disabled={!selectedConversation}
              className="w-full resize-none rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50 disabled:opacity-50"
            />
            <input
              type="datetime-local"
              value={newDueAt}
              onChange={(e) => setNewDueAt(e.target.value)}
              disabled={!selectedConversation}
              className="w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50 disabled:opacity-50"
            />
          </div>

          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setNewTaskOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleCreateTask}
              disabled={!selectedConversation || !newNote.trim() || !newDueAt || creating}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {creating ? <Loader2 className="size-4 animate-spin" /> : 'Criar tarefa'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
