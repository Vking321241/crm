'use client';

// ============================================================
// CloseConversationModal — shown when the agent clicks "Encerrar
// Atendimento" instead of flipping the status straight to closed.
// Three options, per the client's spec:
//   1. Falta de interação — silent close, no message to the customer.
//   2. Enviar nota (pesquisa) — sends a short satisfaction-survey
//      message to the customer, then closes.
//   3. Encerrar sem mensagem — same as (1), kept as a distinct explicit
//      choice so "no message" reads as a decision, not an omission.
// ============================================================

import { useState } from 'react';
import { Loader2, MessageSquareOff, ClipboardCheck, XCircle } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export type CloseReason = 'no_interaction' | 'survey' | 'silent';

interface CloseConversationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: CloseReason) => Promise<void> | void;
}

const SURVEY_MESSAGE =
  'Encerramos este atendimento por aqui. Podemos contar com sua avaliação? Responda de 1 (ruim) a 5 (ótimo) 🙂';

const OPTIONS: {
  reason: CloseReason;
  icon: typeof MessageSquareOff;
  title: string;
  description: string;
}[] = [
  {
    reason: 'no_interaction',
    icon: XCircle,
    title: 'Falta de interação',
    description: 'Encerra por falta de resposta do cliente. Nenhuma mensagem é enviada.',
  },
  {
    reason: 'survey',
    icon: ClipboardCheck,
    title: 'Enviar nota para atendimento (pesquisa)',
    description: 'Envia uma mensagem pedindo para o cliente avaliar o atendimento, depois encerra.',
  },
  {
    reason: 'silent',
    icon: MessageSquareOff,
    title: 'Encerrar sem mensagem',
    description: 'Encerra imediatamente, sem enviar nada ao cliente.',
  },
];

export { SURVEY_MESSAGE };

export function CloseConversationModal({
  open,
  onOpenChange,
  onConfirm,
}: CloseConversationModalProps) {
  const [pending, setPending] = useState<CloseReason | null>(null);

  async function handleChoice(reason: CloseReason) {
    setPending(reason);
    try {
      await onConfirm(reason);
      onOpenChange(false);
    } finally {
      setPending(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">Encerrar atendimento</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Escolha como este atendimento deve ser encerrado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const isPending = pending === opt.reason;
            return (
              <button
                key={opt.reason}
                type="button"
                disabled={pending !== null}
                onClick={() => void handleChoice(opt.reason)}
                className="flex w-full items-start gap-3 rounded-lg border border-border bg-card px-3 py-3 text-left transition-colors hover:bg-muted disabled:opacity-60"
              >
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  {isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Icon className="size-4" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{opt.title}</span>
                  <span className="block text-xs text-muted-foreground">{opt.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
