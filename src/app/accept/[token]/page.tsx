"use client";

// ============================================================
// /accept/[token] — the single landing page for both single-use
// token purposes (see src/db/schema.ts `auth_tokens`):
//   - 'invite'        — someone new joining an account. Collects
//     name + email + password, creates the user already scoped to
//     that account.
//   - 'set_password'  — an existing user (created by the platform
//     owner via /admin) setting their password for the first time.
//     Only asks for a password; email is shown, not editable.
//
// Replaces both the old /join/[token] (Supabase invite redeem) and
// /signup (Supabase email/password signup) — there's no separate
// "create a Supabase auth user, then redeem" dance anymore, so the
// two screens collapse into one.
// ============================================================

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle, Loader2, MailX, UsersRound } from "lucide-react";

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

type PeekResult =
  | { ok: true; purpose: "invite"; accountName: string | null; role: string }
  | { ok: true; purpose: "set_password"; email: string | null }
  | { ok: false; reason: "not_found" | "used" | "expired" };

const FAIL_COPY: Record<Exclude<PeekResult, { ok: true }>["reason"], { title: string; body: string }> = {
  not_found: {
    title: "Link não encontrado",
    body: "Este link não corresponde a um convite válido. Peça um novo link a quem te convidou.",
  },
  used: {
    title: "Link já utilizado",
    body: "Este link já foi usado. Se não foi você, peça um novo ao administrador.",
  },
  expired: {
    title: "Link expirado",
    body: "Este link expirou. Peça ao administrador para gerar um novo.",
  },
};

export default function AcceptPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = params?.token;

  const [peek, setPeek] = useState<PeekResult | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/auth/accept-token?token=${encodeURIComponent(token)}`, {
          cache: "no-store",
        });
        const data = (await res.json()) as PeekResult;
        if (!cancelled) setPeek(data);
      } catch (err) {
        console.error("[accept] peek error:", err);
        if (!cancelled) setPeek({ ok: false, reason: "not_found" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("As senhas não coincidem");
      return;
    }
    if (password.length < 8) {
      setError("A senha precisa ter pelo menos 8 caracteres");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/accept-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email, fullName, password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error || "Falha ao concluir o cadastro");
        setSubmitting(false);
        return;
      }
      toast.success("Conta pronta!");
      window.location.href = "/inbox";
    } catch (err) {
      console.error("[accept] submit error:", err);
      toast.error("Não foi possível concluir. Tente novamente.");
      setSubmitting(false);
    }
  };

  if (peek === null) {
    return (
      <Card className="w-full max-w-md border-border bg-card">
        <CardContent className="flex flex-col items-center gap-3 py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Verificando link…</p>
        </CardContent>
      </Card>
    );
  }

  if (!peek.ok) {
    const copy = FAIL_COPY[peek.reason];
    return (
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10">
            <MailX className="h-6 w-6 text-red-400" />
          </div>
          <CardTitle className="text-xl text-foreground">{copy.title}</CardTitle>
          <CardDescription className="text-muted-foreground">{copy.body}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="w-full border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => router.push("/login")}
          >
            Ir para o login
          </Button>
        </CardContent>
      </Card>
    );
  }

  const isInvite = peek.purpose === "invite";

  return (
    <Card className="w-full max-w-md border-border bg-card">
      <CardHeader className="items-center text-center">
        <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          {isInvite ? (
            <UsersRound className="h-6 w-6 text-primary" />
          ) : (
            <CheckCircle className="h-6 w-6 text-primary" />
          )}
        </div>
        <CardTitle className="text-xl text-foreground">
          {isInvite ? `Você foi convidado para ${peek.accountName ?? "uma conta"}` : "Defina sua senha"}
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {isInvite
            ? `Entrando como ${peek.role}. Preencha seus dados para começar.`
            : peek.email
              ? `Conta: ${peek.email}`
              : "Escolha uma senha para acessar o DivaryTalk."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              <AlertTriangle className="size-4 shrink-0" />
              {error}
            </div>
          )}

          {isInvite && (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="fullName">Nome completo</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              placeholder="Mínimo 8 caracteres"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirmPassword">Confirmar senha</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          <Button
            type="submit"
            disabled={submitting}
            className="mt-2 h-10 w-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {submitting ? "Concluindo…" : isInvite ? "Criar conta" : "Definir senha e entrar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
