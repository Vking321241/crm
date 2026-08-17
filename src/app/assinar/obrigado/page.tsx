"use client";

// ============================================================
// /assinar/obrigado — public "thank you" page a Kiwify checkout
// should redirect to after a successful payment. Collects the info
// the Divary team needs to actually create the client's account:
// company name, domain (optional — used later for the atendente
// email pattern, see accounts.emailDomain), email, and phone.
//
// Submitting POSTs to /api/public/signup-leads, which stores the
// lead and notifies the platform account's admins (Notificações
// tab). This page does NOT provision an account — a human on the
// Divary side still runs /admin → "Criar cliente" and sends the
// access link, same as always. That's deliberate: the form's only
// job is making sure the phone/email make it to someone in one place
// instead of getting lost between Kiwify's own notification email and
// whoever happens to check it.
// ============================================================

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function AssinarObrigadoPage() {
  const [companyName, setCompanyName] = useState("");
  const [domain, setDomain] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/public/signup-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: companyName.trim(),
          domain: domain.trim() || undefined,
          email: email.trim(),
          phone: phone.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Não foi possível enviar seus dados. Tente novamente.");
        return;
      }
      setDone(true);
    } catch {
      setError("Não foi possível conectar ao servidor. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="flex min-h-full items-center justify-center bg-background px-4 py-16">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <CheckCircle2 className="size-10 text-primary" />
            <p className="text-lg font-semibold text-foreground">Prontinho!</p>
            <p className="text-sm text-muted-foreground">
              Recebemos seus dados. Nossa equipe vai te enviar o link de acesso no e-mail ou
              WhatsApp informado em instantes.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-background px-4 py-16">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Pagamento confirmado 🎉</CardTitle>
          <CardDescription>
            Só falta a gente conhecer sua empresa pra liberar o seu acesso ao DivaryTalk.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="companyName">Nome da empresa</Label>
              <Input
                id="companyName"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="domain">Domínio da empresa (se tiver)</Label>
              <Input
                id="domain"
                placeholder="suaempresa.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">
                E-mail <span className="text-xs text-muted-foreground">(mesmo usado na compra, de preferência)</span>
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="phone">Telefone / WhatsApp</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="(11) 91234-5678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <Button type="submit" disabled={submitting} className="mt-1 w-full">
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Enviando…
                </>
              ) : (
                "Enviar"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
