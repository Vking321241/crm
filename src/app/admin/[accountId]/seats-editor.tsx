"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function ClientDetailsEditor({
  accountId,
  initialName,
  initialSeats,
}: {
  accountId: string;
  initialName: string;
  initialSeats: number;
}) {
  const [name, setName] = useState(initialName);
  const [seats, setSeats] = useState(initialSeats);
  const [saving, setSaving] = useState(false);

  const dirty = name.trim() !== initialName || seats !== initialSeats;

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("O nome não pode ficar vazio");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/clients/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), maxAgentSeats: seats }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error || "Falha ao atualizar o cliente");
        return;
      }
      toast.success("Cliente atualizado");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-foreground">Dados do cliente</CardTitle>
        <CardDescription className="text-muted-foreground">
          Nome do cliente e quantos usuários o administrador dele pode criar (contando ele mesmo).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="clientName">Nome</Label>
          <Input id="clientName" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex items-end gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="seats">Vagas</Label>
            <Input
              id="seats"
              type="number"
              min={1}
              value={seats}
              onChange={(e) => setSeats(Number(e.target.value))}
              className="w-24"
            />
          </div>
          <Button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Salvar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
