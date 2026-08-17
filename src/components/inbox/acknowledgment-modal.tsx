'use client';

// ============================================================
// AcknowledgmentModal — shown when the agent opens a conversation
// that was just transferred to them (or resumed from a business-
// hours auto-pause) and hasn't confirmed yet.
//
//   "Iniciar atendimento" — PATCHes acknowledge:true, clearing the
//     flag server-side. Never asked again for THIS hand-off.
//   "Apenas visualizar"   — closes the modal locally only, no API
//     call. The flag stays set, so leaving and reopening this
//     conversation shows the pop-up again — until either they pick
//     "Iniciar" or it's transferred away and back (a fresh hand-off).
// ============================================================

import { useState } from 'react';
import { Loader2, PlayCircle, Eye } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface AcknowledgmentModalProps {
  open: boolean;
  reason?: 'transferred' | 'resumed';
  onStart: () => Promise<void> | void;
  onDismiss: () => void;
}

export function AcknowledgmentModal({ open, reason, onStart, onDismiss }: AcknowledgmentModalProps) {
  const [starting, setStarting] = useState(false);

  async function handleStart() {
    setStarting(true);
    try {
      await onStart();
    } finally {
      setStarting(false);
    }
  }

  const isResume = reason === 'resumed';

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onDismiss()}>
      <DialogContent className="bg-popover border-border sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {isResume ? 'Atendimento retomado' : 'Conversa transferida'}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {isResume
              ? 'O horário de atendimento voltou e esta conversa estava pausada. Deseja prosseguir com o atendimento ou apenas visualizar?'
              : 'Esta conversa foi transferida para você. Deseja iniciar o atendimento ou apenas visualizar?'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" className="flex-1" onClick={onDismiss} disabled={starting}>
            <Eye className="size-4" />
            Apenas visualizar
          </Button>
          <Button className="flex-1" onClick={handleStart} disabled={starting}>
            {starting ? <Loader2 className="size-4 animate-spin" /> : <PlayCircle className="size-4" />}
            {isResume ? 'Prosseguir' : 'Iniciar atendimento'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
