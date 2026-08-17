'use client';

// ============================================================
// ConversationTasks — "Tarefas Agendadas" block in the contact
// sidebar. "+ Agendar Tarefa" opens a tiny inline form (date/time +
// note); the list below shows pending tasks first, overdue ones
// flagged in red, and lets an agent check one off.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CalendarClock, Check, Loader2, MessageSquareText, Plus, Trash2 } from 'lucide-react';
import { format, isPast } from 'date-fns';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

interface ConversationTask {
  id: string;
  note: string;
  due_at: string;
  status: 'pending' | 'done';
  completed_at?: string;
  send_as_message: boolean;
}

export function ConversationTasks({ conversationId }: { conversationId: string }) {
  const [tasks, setTasks] = useState<ConversationTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [note, setNote] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [sendAsMessage, setSendAsMessage] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/tasks`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        setTasks((data.tasks as ConversationTask[]) ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  async function handleCreate() {
    if (!note.trim() || !dueAt) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          note: note.trim(),
          dueAt: new Date(dueAt).toISOString(),
          sendAsMessage,
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Falha ao agendar tarefa');
        return;
      }
      setNote('');
      setDueAt('');
      setSendAsMessage(false);
      setFormOpen(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function toggleDone(task: ConversationTask) {
    const nextStatus = task.status === 'done' ? 'pending' : 'done';
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)),
    );
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
    if (!res.ok) {
      toast.error('Falha ao atualizar tarefa');
      await load();
    }
  }

  async function remove(taskId: string) {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
    if (!res.ok) {
      toast.error('Falha ao remover tarefa');
      await load();
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <CalendarClock className="h-3 w-3" />
          Tarefas agendadas
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs text-primary hover:bg-primary/10"
          onClick={() => setFormOpen((v) => !v)}
        >
          <Plus className="mr-1 h-3 w-3" />
          Agendar
        </Button>
      </div>

      {formOpen && (
        <div className="mt-2 space-y-2 rounded-lg border border-border bg-muted/40 p-2.5">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="O que precisa ser feito?"
            rows={2}
            className="w-full resize-none rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
          />
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="w-full rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
          />
          <label className="flex items-start gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={sendAsMessage}
              onCheckedChange={(v) => setSendAsMessage(v === true)}
              className="mt-0.5"
            />
            <span>
              Enviar automaticamente como mensagem no WhatsApp na data/hora marcada
              {sendAsMessage && ' (em vez de só lembrar o atendente)'}
            </span>
          </label>
          <div className="flex justify-end gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => setFormOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              className="h-7 bg-primary px-2 text-xs hover:bg-primary/90"
              onClick={handleCreate}
              disabled={!note.trim() || !dueAt || saving}
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Salvar'}
            </Button>
          </div>
        </div>
      )}

      <div className="mt-2 space-y-1.5">
        {loading ? (
          <div className="flex justify-center py-3">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : tasks.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">Nenhuma tarefa agendada</p>
        ) : (
          tasks.map((task) => {
            const overdue = task.status === 'pending' && isPast(new Date(task.due_at));
            return (
              <div
                key={task.id}
                className="flex items-start gap-2 rounded-lg bg-muted px-2.5 py-2"
              >
                <button
                  type="button"
                  onClick={() => toggleDone(task)}
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
                        ? 'text-xs text-muted-foreground line-through'
                        : 'text-xs text-foreground'
                    }
                  >
                    {task.send_as_message && (
                      <MessageSquareText
                        className="mr-1 inline-block size-3 shrink-0 align-text-top text-primary"
                        aria-label="Mensagem agendada"
                      />
                    )}
                    {task.note}
                  </p>
                  <p className={overdue ? 'mt-0.5 text-[10px] font-medium text-red-400' : 'mt-0.5 text-[10px] text-muted-foreground'}>
                    {overdue ? (task.send_as_message ? 'Envio atrasado · ' : 'Atrasada · ') : ''}
                    {format(new Date(task.due_at), 'dd/MM/yyyy HH:mm')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => remove(task.id)}
                  aria-label="Remover tarefa"
                  className="shrink-0 text-muted-foreground hover:text-red-400"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
