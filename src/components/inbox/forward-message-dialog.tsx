"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Message } from "@/types";

interface ConversationOption {
  id: string;
  contact: { name: string | null; phone: string };
}

interface ForwardMessageDialogProps {
  message: Message | null;
  currentConversationId: string;
  onOpenChange: (open: boolean) => void;
}

const MEDIA_TYPES = new Set(["image", "video", "document", "audio"]);

export function ForwardMessageDialog({
  message,
  currentConversationId,
  onOpenChange,
}: ForwardMessageDialogProps) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<ConversationOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  useEffect(() => {
    if (!message) {
      setQuery("");
      setOptions([]);
    }
  }, [message]);

  useEffect(() => {
    if (!message) return;
    const q = query.trim();
    if (q.length < 2) {
      setOptions([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      fetch(`/api/conversations?search=${encodeURIComponent(q)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((data) => setOptions((data.conversations as ConversationOption[]) ?? []))
        .catch(() => setOptions([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, message]);

  async function handleForwardTo(targetId: string) {
    if (!message) return;
    setSendingId(targetId);
    try {
      const isMedia = MEDIA_TYPES.has(message.content_type);
      if (!isMedia && message.content_type !== "text") {
        toast.error("Esse tipo de mensagem não pode ser encaminhado");
        return;
      }
      if (isMedia && !message.media_url) {
        toast.error("Mídia não disponível para encaminhar");
        return;
      }

      const res = await fetch(`/api/conversations/${targetId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message_type: message.content_type,
          content_text: message.content_text,
          media_url: isMedia ? message.media_url : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Falha ao encaminhar");
        return;
      }
      toast.success(
        targetId === currentConversationId
          ? "Mensagem encaminhada nesta conversa"
          : "Mensagem encaminhada",
      );
      onOpenChange(false);
    } finally {
      setSendingId(null);
    }
  }

  return (
    <Dialog open={!!message} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Encaminhar mensagem</DialogTitle>
          <DialogDescription>Escolha o contato ou conversa de destino.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome ou telefone..."
              className="w-full rounded-md border border-border bg-muted py-2 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50"
            />
          </div>
          {searching ? (
            <div className="flex justify-center py-3">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : options.length > 0 ? (
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {options.map((c) => (
                <li key={c.id}>
                  <Button
                    variant="ghost"
                    className="w-full justify-start"
                    disabled={sendingId !== null}
                    onClick={() => handleForwardTo(c.id)}
                  >
                    {sendingId === c.id && <Loader2 className="size-4 animate-spin" />}
                    <span className="truncate">{c.contact.name || c.contact.phone}</span>
                    {c.contact.name && (
                      <span className="ml-2 truncate text-xs text-muted-foreground">
                        {c.contact.phone}
                      </span>
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          ) : query.trim().length >= 2 ? (
            <p className="px-1 text-xs text-muted-foreground">Nenhuma conversa encontrada</p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
