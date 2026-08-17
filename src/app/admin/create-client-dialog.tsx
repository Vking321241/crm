"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Loader2, Plus } from "lucide-react";

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

interface CreateClientResponse {
  accountId: string;
  setPasswordLink: string | null;
  instanceWarning: string | null;
  error?: string;
}

export function CreateClientDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [clientName, setClientName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [maxAgentSeats, setMaxAgentSeats] = useState(3);
  const [emailDomain, setEmailDomain] = useState("");
  const [result, setResult] = useState<CreateClientResponse | null>(null);

  const reset = () => {
    setClientName("");
    setAdminName("");
    setAdminEmail("");
    setMaxAgentSeats(3);
    setEmailDomain("");
    setResult(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName,
          adminName,
          adminEmail,
          maxAgentSeats,
          emailDomain: emailDomain.trim() || undefined,
        }),
      });
      const data = (await res.json()) as CreateClientResponse;
      if (!res.ok) {
        toast.error(data.error || "Falha ao criar o cliente");
        return;
      }
      setResult(data);
      if (data.instanceWarning) toast.warning(data.instanceWarning);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="size-4" />
            Criar cliente
          </Button>
        }
      />
      <DialogContent className="bg-popover border-border sm:max-w-md">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">Cliente criado</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                Envie este link para o administrador do cliente definir a senha dele.
              </DialogDescription>
            </DialogHeader>
            {result.setPasswordLink ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted p-2">
                <code className="flex-1 truncate text-xs text-foreground">
                  {result.setPasswordLink}
                </code>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="border-border"
                  onClick={() => {
                    navigator.clipboard.writeText(result.setPasswordLink!);
                    toast.success("Link copiado");
                  }}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            ) : (
              <p className="text-sm text-amber-500">
                Não foi possível gerar o link automaticamente — peça para o admin usar &quot;Esqueci
                minha senha&quot; com o e-mail {result.error ? "" : adminEmail}.
              </p>
            )}
            <DialogFooter>
              <Button
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={() => setOpen(false)}
              >
                Concluir
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle className="text-popover-foreground">Criar novo cliente</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                Cria a conta do cliente, o usuário administrador dele e a instância do WhatsApp.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-2">
              <Label htmlFor="clientName">Nome do cliente</Label>
              <Input
                id="clientName"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="adminName">Nome do administrador</Label>
              <Input
                id="adminName"
                value={adminName}
                onChange={(e) => setAdminName(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="adminEmail">E-mail do administrador</Label>
              <Input
                id="adminEmail"
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="maxAgentSeats">Cota de usuários</Label>
              <Input
                id="maxAgentSeats"
                type="number"
                min={1}
                value={maxAgentSeats}
                onChange={(e) => setMaxAgentSeats(Number(e.target.value))}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="emailDomain">Domínio para e-mail dos atendentes</Label>
              <Input
                id="emailDomain"
                placeholder="cliente1.com"
                value={emailDomain}
                onChange={(e) => setEmailDomain(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                O admin do cliente vai criar atendentes digitando só o nome — o e-mail de
                login é montado automaticamente como nome@{emailDomain || "dominio.com"}. Pode
                deixar em branco e configurar depois em Configurações → Membros.
              </p>
            </div>

            <DialogFooter>
              <Button
                type="submit"
                disabled={submitting}
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Criando…
                  </>
                ) : (
                  "Criar cliente"
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
