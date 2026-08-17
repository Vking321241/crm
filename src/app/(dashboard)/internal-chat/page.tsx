'use client';

// ============================================================
// Chat Interno — team-only messaging (never visible to customers).
// Two-pane layout: channel list (DMs + groups) on the left, thread on
// the right. Follows the same polling convention as the inbox — no
// realtime layer in this app.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { Loader2, MessageCircle, Plus, Send, UsersRound } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface Channel {
  id: string;
  display_name: string;
  is_direct: boolean;
  last_message_text?: string;
  last_message_at?: string;
  unread_count: number;
}

interface InternalMessage {
  id: string;
  channel_id: string;
  sender_id?: string;
  content_text?: string;
  created_at: string;
}

interface MemberLite {
  user_id: string;
  full_name: string;
}

const POLL_MS = 4000;

export default function InternalChatPage() {
  const { user, hasPermission, profileLoading } = useAuth();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<InternalMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [members, setMembers] = useState<MemberLite[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadChannels = useCallback(async () => {
    const res = await fetch('/api/internal-chat/channels', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setChannels((data.channels as Channel[]) ?? []);
    }
    setLoadingChannels(false);
  }, []);

  useEffect(() => {
    void loadChannels();
    const timer = setInterval(() => void loadChannels(), POLL_MS);
    return () => clearInterval(timer);
  }, [loadChannels]);

  const loadMessages = useCallback(async (channelId: string) => {
    const res = await fetch(`/api/internal-chat/channels/${channelId}/messages`, {
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      setMessages((data.messages as InternalMessage[]) ?? []);
    }
  }, []);

  useEffect(() => {
    if (!activeId) return;
    void loadMessages(activeId);
    const timer = setInterval(() => void loadMessages(activeId), POLL_MS);
    return () => clearInterval(timer);
  }, [activeId, loadMessages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function handleSend() {
    if (!activeId || !text.trim() || sending) return;
    setSending(true);
    const body = text.trim();
    setText('');
    try {
      const res = await fetch(`/api/internal-chat/channels/${activeId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contentText: body }),
      });
      if (!res.ok) {
        toast.error('Falha ao enviar mensagem');
        return;
      }
      await loadMessages(activeId);
      await loadChannels();
    } finally {
      setSending(false);
    }
  }

  async function openNewChat() {
    setNewChatOpen(true);
    if (members.length > 0) return;
    const res = await fetch('/api/account/members', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setMembers(
        ((data.members ?? []) as { user_id: string; full_name: string }[]).filter(
          (m) => m.user_id !== user?.id,
        ),
      );
    }
  }

  async function startDm(targetUserId: string) {
    const res = await fetch('/api/internal-chat/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetUserId }),
    });
    if (!res.ok) {
      toast.error('Falha ao iniciar conversa');
      return;
    }
    const data = await res.json();
    setNewChatOpen(false);
    await loadChannels();
    setActiveId(data.channel.id);
  }

  if (!profileLoading && !hasPermission('internal_chat')) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Você não tem acesso ao Chat Interno. Peça a um administrador para liberar em
          Configurações → Permissões.
        </p>
      </div>
    );
  }

  const activeChannel = channels.find((c) => c.id === activeId) ?? null;

  return (
    <div className="-m-4 flex h-[calc(100vh-3.5rem)] overflow-hidden sm:-m-6">
      {/* Channel list */}
      <div className="flex h-full w-72 shrink-0 flex-col border-r border-border bg-card">
        <div className="flex items-center justify-between border-b border-border p-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <MessageCircle className="size-4" />
            Chat Interno
          </h2>
          <Button size="icon-sm" variant="ghost" onClick={openNewChat}>
            <Plus className="size-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loadingChannels ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : channels.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted-foreground">
              Nenhuma conversa ainda. Clique em + para começar.
            </p>
          ) : (
            channels.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveId(c.id)}
                className={cn(
                  'flex w-full flex-col gap-0.5 border-l-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/50',
                  activeId === c.id ? 'border-primary bg-muted/70' : 'border-transparent',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {c.is_direct ? c.display_name : `# ${c.display_name}`}
                  </span>
                  {c.unread_count > 0 && (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                      {c.unread_count}
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {c.last_message_text ?? 'Sem mensagens'}
                </p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Thread */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!activeChannel ? (
          <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
            <MessageCircle className="size-10" />
            <p className="mt-2 text-sm">Selecione uma conversa</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-border bg-card px-4 py-3">
              {activeChannel.is_direct ? null : <UsersRound className="size-4 text-muted-foreground" />}
              <h3 className="text-sm font-semibold text-foreground">
                {activeChannel.is_direct ? activeChannel.display_name : `# ${activeChannel.display_name}`}
              </h3>
            </div>
            <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
              {messages.map((m) => {
                const mine = m.sender_id === user?.id;
                return (
                  <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                    <div
                      className={cn(
                        'max-w-[70%] rounded-2xl px-3.5 py-2 text-sm',
                        mine
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-foreground',
                      )}
                    >
                      <p className="whitespace-pre-wrap">{m.content_text}</p>
                      <p
                        className={cn(
                          'mt-1 text-[10px]',
                          mine ? 'text-primary-foreground/70' : 'text-muted-foreground',
                        )}
                      >
                        {formatDistanceToNow(new Date(m.created_at), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-end gap-2 border-t border-border bg-card p-3">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder="Escreva uma mensagem para a equipe..."
                rows={1}
                className="flex-1 resize-none rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
              />
              <Button
                size="sm"
                onClick={handleSend}
                disabled={!text.trim() || sending}
                className="h-9 w-9 shrink-0 bg-primary p-0 hover:bg-primary/90"
              >
                <Send className="size-4" />
              </Button>
            </div>
          </>
        )}
      </div>

      <Dialog open={newChatOpen} onOpenChange={setNewChatOpen}>
        <DialogContent className="bg-popover border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">Nova conversa</DialogTitle>
          </DialogHeader>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {members.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Nenhum colega disponível
              </p>
            ) : (
              members.map((m) => (
                <button
                  key={m.user_id}
                  type="button"
                  onClick={() => startDm(m.user_id)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-foreground hover:bg-muted"
                >
                  {m.full_name}
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
