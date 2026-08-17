"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Message } from "@/types";

interface EditMessageDialogProps {
  conversationId: string;
  message: Message | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (messageId: string, text: string) => void;
}

export function EditMessageDialog({
  conversationId,
  message,
  onOpenChange,
  onSaved,
}: EditMessageDialogProps) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setText(message?.content_text ?? "");
  }, [message]);

  async function handleSave() {
    if (!message || !text.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages/${message.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Falha ao editar a mensagem");
        return;
      }
      onSaved(message.id, text.trim());
      toast.success("Mensagem editada");
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!message} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar mensagem</DialogTitle>
          <DialogDescription>
            O WhatsApp só permite editar por um tempo limitado após o envio.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          autoFocus
          maxLength={4096}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || !text.trim()}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
