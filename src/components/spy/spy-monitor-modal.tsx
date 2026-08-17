'use client';

// ============================================================
// SpyMonitorModal — "Monitoramento Silencioso". Shows the full live
// conversation without the customer or the agent knowing (reads
// through /api/conversations/[id]/spy, which never touches
// unread_count). Quick actions: take the conversation over, or send
// a private note to the assigned agent (via the existing contact
// notes thread — still internal-only, never reaches the customer).
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, UserCog, Send } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MessageBubble } from '@/components/inbox/message-bubble';
import type { Message, MessageReaction } from '@/types';

type MessageWithReactions = Message & { reactions: MessageReaction[] };

interface SpyMonitorModalProps {
  conversationId: string | null;
  contactId: string | null;
  contactName: string;
  agentName: string | null;
  onOpenChange: (open: boolean) => void;
  onTakeOver: (conversationId: string) => Promise<void>;
}

/** Poll cadence for the silent monitor — matches the inbox thread's
 *  own poll rate so nothing about spy mode is observably different. */
const POLL_MS = 4000;

export function SpyMonitorModal({
  conversationId,
  contactId,
  contactName,
  agentName,
  onOpenChange,
  onTakeOver,
}: SpyMonitorModalProps) {
  const [messages, setMessages] = useState<MessageWithReactions[]>([]);
  const [loading, setLoading] = useState(true);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [sendingNote, setSendingNote] = useState(false);
  const [takingOver, setTakingOver] = useState(false);

  const load = useCallback(
    async (showSpinner: boolean) => {
      if (!conversationId) return;
      if (showSpinner) setLoading(true);
      try {
        const res = await fetch(`/api/conversations/${conversationId}/spy`, {
          cache: 'no-store',
        });
        if (res.ok) {
          const data = await res.json();
          setMessages((data.messages ?? []) as MessageWithReactions[]);
        }
      } finally {
        if (showSpinner) setLoading(false);
      }
    },
    [conversationId],
  );

  useEffect(() => {
    if (!conversationId) return;
    void load(true);
    const timer = setInterval(() => void load(false), POLL_MS);
    return () => clearInterval(timer);
  }, [conversationId, load]);

  async function handleSendNote() {
    if (!contactId || !note.trim()) return;
    setSendingNote(true);
    try {
      const prefix = agentName ? `[Nota do gestor para ${agentName}] ` : '[Nota do gestor] ';
      const res = await fetch(`/api/contacts/${contactId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ noteText: `${prefix}${note.trim()}` }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Falha ao enviar nota');
        return;
      }
      toast.success('Nota privada enviada ao atendente');
      setNote('');
      setNoteOpen(false);
    } finally {
      setSendingNote(false);
    }
  }

  async function handleTakeOver() {
    if (!conversationId) return;
    setTakingOver(true);
    try {
      await onTakeOver(conversationId);
      onOpenChange(false);
    } finally {
      setTakingOver(false);
    }
  }

  return (
    <Dialog open={conversationId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col bg-popover border-border sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {contactName}
            {agentName && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                atendido por {agentName}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-lg bg-background px-3 py-3">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Sem mensagens ainda</p>
          ) : (
            messages.map((msg) => <MessageBubble key={msg.id} message={msg} reactions={msg.reactions} />)
          )}
        </div>

        {noteOpen && (
          <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-2.5">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={`Mensagem privada para ${agentName ?? 'o atendente'}...`}
              rows={2}
              className="w-full resize-none rounded-md border border-border bg-muted px-2.5 py-1.5 text-xs text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
            />
            <div className="flex justify-end gap-1.5">
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setNoteOpen(false)}>
                Cancelar
              </Button>
              <Button
                size="sm"
                className="h-7 bg-primary px-2 text-xs hover:bg-primary/90"
                onClick={handleSendNote}
                disabled={!note.trim() || sendingNote}
              >
                {sendingNote ? <Loader2 className="size-3 animate-spin" /> : 'Enviar'}
              </Button>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={handleTakeOver}
            disabled={takingOver}
          >
            {takingOver ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <UserCog className="mr-1.5 size-4" />
            )}
            Assumir Conversa
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => setNoteOpen((v) => !v)}>
            <Send className="mr-1.5 size-4" />
            Nota Privada
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
