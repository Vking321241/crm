'use client';

// ============================================================
// Modo Espião — supervisor panel. A live grid of every open/pending
// conversation account-wide (agent, customer, duration, last
// message). Clicking a card opens SpyMonitorModal for silent
// monitoring — the customer and the assigned agent never see this.
//
// Gated by the "spy_mode" permission module (see
// src/lib/auth/permissions.ts) — owner/admin always pass; everyone
// else needs an explicit grant from the Configurações → Permissões
// matrix. The server routes enforce this independently
// (requireModule), this client gate is just so a non-permitted user
// doesn't even see the empty shell.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Eye, Radio } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/use-auth';
import { Card, CardContent } from '@/components/ui/card';
import { SpyMonitorModal } from '@/components/spy/spy-monitor-modal';

interface LiveConversation {
  id: string;
  status: 'open' | 'pending';
  contact_id: string;
  contact_name: string;
  agent_id: string | null;
  agent_name: string | null;
  last_message_text: string | null;
  last_message_at: string | null;
  started_at: string;
}

const POLL_MS = 5000;

export default function SpyModePage() {
  const { hasPermission, profileLoading, user } = useAuth();
  const [items, setItems] = useState<LiveConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<LiveConversation | null>(null);

  const load = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setLoading(true);
    try {
      const res = await fetch('/api/conversations/live', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setItems((data.conversations ?? []) as LiveConversation[]);
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

  async function handleTakeOver(conversationId: string) {
    if (!user?.id) return;
    const res = await fetch(`/api/conversations/${conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assigned_agent_id: user.id }),
    });
    if (!res.ok) {
      toast.error('Falha ao assumir a conversa');
      return;
    }
    toast.success('Você assumiu esta conversa');
    void load(false);
  }

  if (!profileLoading && !hasPermission('spy_mode')) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Você não tem acesso ao Modo Espião. Peça a um administrador para liberar em
          Configurações → Permissões.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <Radio className="size-5 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Modo Espião</h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Supervisão em tempo real de todos os atendimentos em andamento.
      </p>

      {loading ? (
        <div className="mt-8 flex justify-center">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : items.length === 0 ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">
          Nenhum atendimento em andamento no momento.
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map((item) => (
            <Card
              key={item.id}
              className="cursor-pointer transition-colors hover:border-primary/50"
              onClick={() => setSelected(item)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {item.contact_name}
                  </p>
                  <span
                    className={
                      item.status === 'pending'
                        ? 'shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-500'
                        : 'shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary'
                    }
                  >
                    {item.status === 'pending' ? 'Pendente' : 'Ativo'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.agent_name ?? 'Sem atendente'}
                </p>
                <p className="mt-2 truncate text-xs text-muted-foreground">
                  {item.last_message_text || 'Sem mensagens'}
                </p>
                <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>
                    Duração: {formatDistanceToNow(new Date(item.started_at))}
                  </span>
                  <Eye className="size-3.5" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <SpyMonitorModal
        conversationId={selected?.id ?? null}
        contactId={selected?.contact_id ?? null}
        contactName={selected?.contact_name ?? ''}
        agentName={selected?.agent_name ?? null}
        onOpenChange={(open) => !open && setSelected(null)}
        onTakeOver={handleTakeOver}
      />
    </div>
  );
}
