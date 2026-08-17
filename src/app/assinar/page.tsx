// ============================================================
// /assinar — public pricing page. No auth, no sidebar (top-level
// route, same pattern as /accept/[token]). Lists the 4 Kiwify seat-
// tier plans (single source of truth: src/lib/kiwify/plans.ts, same
// one Settings → Assinatura reads from) and sends the visitor straight
// to Kiwify's hosted checkout.
//
// After a successful purchase, configure each Kiwify product's
// checkout to redirect to /assinar/obrigado — that page collects the
// company details we need to actually provision the account. This
// page doesn't know anything about that step; Kiwify owns the
// post-payment redirect.
// ============================================================

import type { Metadata } from "next";

import { KIWIFY_PLANS } from "@/lib/kiwify/plans";

export const metadata: Metadata = {
  title: "Planos",
};

export default function AssinarPage() {
  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-sm font-semibold uppercase tracking-wider text-primary">
            DivaryTalk
          </span>
          <h1 className="mt-3 text-3xl font-bold text-foreground sm:text-4xl">
            Escolha o plano da sua equipe
          </h1>
          <p className="mt-3 text-base text-muted-foreground">
            Central de atendimento no WhatsApp com múltiplos atendentes, automações de mensagem e
            estatísticas — tudo em um só lugar.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {KIWIFY_PLANS.map((plan) => (
            <div
              key={plan.key}
              className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm"
            >
              <p className="text-sm font-semibold text-foreground">
                Até {plan.seats} atendentes
              </p>
              <p className="mt-3 text-2xl font-bold text-foreground">{plan.priceLabel}</p>
              <p className="mt-1 text-xs text-muted-foreground">{plan.firstMonthLabel}</p>
              <a
                href={plan.checkoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-6 inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Assinar
              </a>
            </div>
          ))}
        </div>

        <p className="mx-auto mt-10 max-w-xl text-center text-xs text-muted-foreground">
          O pagamento é processado com segurança pela Kiwify. Depois de assinar, você vai
          preencher os dados da sua empresa para a gente liberar seu acesso.
        </p>
      </div>
    </div>
  );
}
