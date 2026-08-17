'use client';

// ============================================================
// SubscriptionPanel — Settings → Assinatura. Shows the account's
// current Kiwify plan/status and the 4 checkout links. Only the
// account owner sees the action buttons (upgrading/canceling
// billing is an owner-level decision) — an admin sees the status
// read-only.
//
// "Cancelar assinatura" calls our own backend
// (POST /api/account/subscription/cancel), which calls Kiwify's API
// directly — the whole point is that the owner never has to leave
// DivaryTalk or touch Kiwify's dashboard. The webhook
// (src/app/api/kiwify/webhook) still runs when Kiwify fires its own
// cancellation event and just re-applies the same state, so the two
// paths can't drift.
// ============================================================

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Loader2, XCircle, Clock } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

export function SubscriptionPanel() {
  const { isOwner, profile } = useAuth();
  const [data, setData] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [canceling, setCanceling] = useState(false);

  const load = () =>
    fetch('/api/account/subscription', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  async function handleCancel() {
    setCanceling(true);
    try {
      const res = await fetch('/api/account/subscription/cancel', { method: 'POST' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || 'Falha ao cancelar a assinatura');
        return;
      }
      toast.success('Assinatura cancelada');
      setCancelOpen(false);
      await load();
    } finally {
      setCanceling(false);
    }
  }

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
          {isOwner && (status === 'active' || status === 'past_due') && (
            <Button
              variant="outline"
              className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:border-red-500/60 hover:text-red-200"
              onClick={() => setCancelOpen(true)}
            >
              Cancelar assinatura
            </Button>
          )}
        </CardContent>
      </Card>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="bg-popover border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-popover-foreground">
              <AlertTriangle className="size-4 text-amber-400" />
              Cancelar assinatura
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Isso cancela sua assinatura diretamente na Kiwify. O acesso continua até o fim do
              período já pago, mas não vai renovar.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setCancelOpen(false)}
              disabled={canceling}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Voltar
            </Button>
            <Button onClick={handleCancel} disabled={canceling} className="bg-red-600 hover:bg-red-700 text-white">
              {canceling ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Cancelando…
                </>
              ) : (
                'Confirmar cancelamento'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
