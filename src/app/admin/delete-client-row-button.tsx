"use client";

// ============================================================
// DeleteClientRowButton — same irreversible delete as
// [accountId]/delete-client-button.tsx, but as a compact icon button
// for the clients list row so deleting a client doesn't require
// first clicking into its detail page. Same type-the-name confirm
// pattern (GitHub-repo-delete style) since the action is just as
// destructive here as it is on the detail page.
// ============================================================

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function DeleteClientRowButton({
  accountId,
  clientName,
}: {
  accountId: string;
  clientName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/clients/${accountId}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error || "Falha ao apagar o cliente");
        return;
      }
      toast.success("Cliente apagado");
      setOpen(false);
      router.refresh();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirmText("");
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
            onClick={(e) => e.stopPropagation()}
            title="Apagar cliente"
          >
            <Trash2 className="size-4" />
          </Button>
        }
      />
      <DialogContent className="bg-popover border-border sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">Apagar {clientName}?</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Apaga o cliente e todos os dados dele: usuários, contatos, conversas, mensagens,
            pipelines, broadcasts e a instância do WhatsApp. Não pode ser desfeito. Para
            confirmar, digite <span className="font-medium text-foreground">{clientName}</span>{" "}
            abaixo.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`confirmName-${accountId}`}>Nome do cliente</Label>
          <Input
            id={`confirmName-${accountId}`}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoComplete="off"
          />
        </div>
        <DialogFooter>
          <Button
            variant="destructive"
            className="w-full"
            disabled={confirmText !== clientName || deleting}
            onClick={handleDelete}
          >
            {deleting && <Loader2 className="size-4 animate-spin" />}
            Apagar definitivamente
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
