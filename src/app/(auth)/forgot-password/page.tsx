import Link from "next/link";
import { ArrowLeft, ShieldQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// DivaryTalk has no automated email sending — every account is
// provisioned (and every password reset) by hand: the platform
// owner or the client's own admin generates a fresh "set password"
// link and shares it directly. This page just points the visitor
// at the right person instead of pretending to send an email.
export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md border-border bg-card">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <ShieldQuestion className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-xl text-foreground">Esqueceu a senha?</CardTitle>
          <CardDescription className="text-muted-foreground">
            O DivaryTalk não envia e-mails automáticos. Peça ao administrador da sua conta
            (ou ao administrador da plataforma, se você for o admin) para gerar um novo link
            de definição de senha para você.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/login">
            <Button
              variant="outline"
              className="w-full border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Voltar para o login
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
