"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// Deleting an account cascades (ON DELETE CASCADE, see src/db/schema.ts)
// through every dependent table — users, contacts, conversations,
// messages, pipelines, broadcasts, the WhatsApp instance. Irreversible,
// so confirmation requires retyping the client's name (same pattern as
// GitHub repo deletion) rather than a single "are you sure" click.
export function DeleteClientButton({
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
      router.push("/admin");
      router.refresh();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card className="border-destructive/40 bg-card">
      <CardHeader>
        <CardTitle className="text-destructive">Zona de risco</CardTitle>
        <CardDescription className="text-muted-foreground">
          Apaga o cliente e todos os dados dele: usuários, contatos, conversas, mensagens,
          pipelines, broadcasts e a instância do WhatsApp. Não pode ser desfeito.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setConfirmText("");
          }}
        >
          <DialogTrigger
            render={
              <Button variant="destructive">
                <Trash2 className="size-4" />
                Apagar cliente
              </Button>
            }
          />
          <DialogContent className="bg-popover border-border sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">Apagar {clientName}?</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                Esta ação é irreversível. Para confirmar, digite{" "}
                <span className="font-medium text-foreground">{clientName}</span> abaixo.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="confirmName">Nome do cliente</Label>
              <Input
                id="confirmName"
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
      </CardContent>
    </Card>
  );
}
