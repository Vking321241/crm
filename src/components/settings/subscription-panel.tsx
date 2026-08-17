'use client';

// ============================================================
// SubscriptionPanel — Settings → Assinatura. Shows the account's
// current Kiwify plan/status and the 4 checkout links. Only the
// account owner sees the action buttons (upgrading/canceling
// billing is an owner-level decision) — an admin sees the status
// read-only.
//
// "Cancelar" links out to Kiwify's own member area rather than
// calling a cancel-by-API endpoint: Kiwify doesn't expose a public
// customer-facing cancellation API, so the real cancellation still
// has to happen on their side. The webhook (src/app/api/kiwify/webhook)
// is what syncs that cancellation back into DivaryTalk automatically
// once Kiwify fires the event — no manual step needed after that.
// ============================================================

import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, Loader2, XCircle, Clock } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';
import { KIWIFY_PLANS } from '@/lib/kiwify/plans';

interface SubscriptionData {
  plan: string | null;
  status: 'none' | 'active' | 'past_due' | 'canceled';
  renews_at: string | null;
  canceled_at: string | null;
  kiwify_email: string | null;
  max_agent_seats: number;
}

const STATUS_META: Record<SubscriptionData['status'], { label: string; icon: typeof CheckCircle2; tone: string }> = {
  active: { label: 'Ativa', icon: CheckCircle2, tone: 'text-primary' },
  past_due: { label: 'Pagamento pendente', icon: Clock, tone: 'text-amber-400' },
  canceled: { label: 'Cancelada', icon: XCircle, tone: 'text-red-400' },
  none: { label: 'Sem assinatura ativa', icon: XCircle, tone: 'text-muted-foreground' },
};

const KIWIFY_MEMBER_AREA = 'https://dashboard.kiwify.com.br/';

export function SubscriptionPanel() {
  const { isOwner, profile } = useAuth();
  const [data, setData] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/account/subscription', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Carregando...
      </div>
    );
  }

  const status = data?.status ?? 'none';
  const meta = STATUS_META[status];
  const StatusIcon = meta.icon;
  const currentPlan = KIWIFY_PLANS.find((p) => p.key === data?.plan);
  const ownerEmail = profile?.email ?? '';

  return (
    <div>
      <SettingsPanelHead
        title="Assinatura"
        description="Plano do DivaryTalk contratado via Kiwify."
      />

      <Card className="mb-6">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <StatusIcon className={`size-8 ${meta.tone}`} />
            <div>
              <p className="text-sm font-medium text-foreground">
                {currentPlan
                  ? `Plano até ${currentPlan.seats} atendentes`
                  : 'Nenhum plano identificado'}
              </p>
              <p className={`text-xs ${meta.tone}`}>{meta.label}</p>
              {data?.renews_at && status === 'active' && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Renova em {new Date(data.renews_at).toLocaleDateString('pt-BR')}
                </p>
              )}
            </div>
          </div>
          {isOwner && status === 'active' && (
            <Button
              variant="outline"
              render={<a href={KIWIFY_MEMBER_AREA} target="_blank" rel="noopener noreferrer" />}
            >
              <ExternalLink className="size-4" />
              Gerenciar / cancelar na Kiwify
            </Button>
          )}
        </CardContent>
      </Card>

      {!isOwner ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Apenas o proprietário da conta pode contratar ou alterar o plano.
        </p>
      ) : (
        <>
          <h3 className="mb-3 text-sm font-semibold text-foreground">Planos disponíveis</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {KIWIFY_PLANS.map((plan) => {
              const isCurrent = data?.plan === plan.key && status === 'active';
              const checkoutUrl = ownerEmail
                ? `${plan.checkoutUrl}?email=${encodeURIComponent(ownerEmail)}`
                : plan.checkoutUrl;
              return (
                <Card key={plan.key} className={isCurrent ? 'border-primary' : undefined}>
                  <CardContent className="flex flex-col gap-2 p-4">
                    <p className="text-sm font-semibold text-foreground">
                      Até {plan.seats} atendentes
                    </p>
                    <p className="text-lg font-bold text-foreground">{plan.priceLabel}</p>
                    <p className="text-xs text-muted-foreground">{plan.firstMonthLabel}</p>
                    {isCurrent ? (
                      <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-1 text-xs font-medium text-primary">
                        <CheckCircle2 className="size-3.5" />
                        Plano atual
                      </span>
                    ) : (
                      <Button
                        className="mt-2"
                        render={<a href={checkoutUrl} target="_blank" rel="noopener noreferrer" />}
                      >
                        Assinar
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Assine usando o mesmo e-mail da sua conta ({ownerEmail || 'seu e-mail de login'}) para
            a ativação ser automática.
          </p>
        </>
      )}
    </div>
  );
}
