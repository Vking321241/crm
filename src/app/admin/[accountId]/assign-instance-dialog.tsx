'use client';

// ============================================================
// AssignInstanceDialog — "Definir instância" on a client's admin
// page. Lists every instance that already exists in UAZAPI (under
// the platform's admin token) with its connection status, so the
// platform owner can pick one instead of blindly typing a token.
// Also has a manual-token fallback for instances the list can't see
// (different server, or the list endpoint not matching this UAZAPI
// install — see the comment in uazapi-client.ts's listInstances).
// Assigning immediately configures the webhook server-side.
// ============================================================

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Radio, RefreshCw, Settings2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface UazapiInstance {
  name: string;
  status: 'not_created' | 'qrcode' | 'connecting' | 'connected' | 'disconnected';
  phone_number: string | null;
}

const STATUS_LABEL: Record<UazapiInstance['status'], string> = {
  not_created: 'Não criada',
  qrcode: 'Aguardando QR',
  connecting: 'Conectando',
  connected: 'Conectada',
  disconnected: 'Desconectada',
};

const STATUS_TONE: Record<UazapiInstance['status'], string> = {
  not_created: 'text-muted-foreground',
  qrcode: 'text-amber-400',
  connecting: 'text-amber-400',
  connected: 'text-primary',
  disconnected: 'text-muted-foreground',
};

export function AssignInstanceDialog({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [instances, setInstances] = useState<UazapiInstance[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState<string | null>(null);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualToken, setManualToken] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [manualSubmitting, setManualSubmitting] = useState(false);

  async function loadInstances() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/admin/uazapi-instances', { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(data.error || 'Falha ao listar instâncias');
        setInstances([]);
        return;
      }
      setInstances(data.instances ?? []);
    } catch {
      setLoadError('Não foi possível conectar ao servidor.');
      setInstances([]);
    } finally {
      setLoading(false);
    }
  }

  function handleOpen() {
    setOpen(true);
    void loadInstances();
  }

  async function assign(mode: 'pick' | 'manual', payload: Record<string, string>) {
    const key = mode === 'pick' ? payload.instanceName : 'manual';
    if (mode === 'pick') setAssigning(key);
    else setManualSubmitting(true);
    try {
      const res = await fetch(`/api/admin/clients/${accountId}/instance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, ...payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Falha ao definir a instância');
        return;
      }
      toast.success(
        data.webhookConfigured
          ? 'Instância definida e webhook configurado.'
          : `Instância definida — mas o webhook falhou: ${data.webhookWarning ?? 'erro desconhecido'}`,
      );
      setOpen(false);
      router.refresh();
    } catch {
      toast.error('Não foi possível conectar ao servidor.');
    } finally {
      setAssigning(null);
      setManualSubmitting(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={handleOpen}>
        <Settings2 className="size-4" />
        Definir instância
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-popover border-border sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-popover-foreground">
              <Radio className="size-4" />
              Definir instância UAZAPI
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Escolha uma instância já existente na UAZAPI. O webhook é configurado
              automaticamente assim que você definir.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : loadError ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                {loadError}
              </div>
            ) : instances && instances.length > 0 ? (
              instances.map((inst) => (
                <div
                  key={inst.name}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{inst.name}</p>
                    <p className={`text-xs ${STATUS_TONE[inst.status]}`}>
                      {STATUS_LABEL[inst.status]}
                      {inst.phone_number ? ` · ${inst.phone_number}` : ''}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    disabled={assigning !== null}
                    onClick={() => assign('pick', { instanceName: inst.name })}
                  >
                    {assigning === inst.name ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      'Usar esta'
                    )}
                  </Button>
                </div>
              ))
            ) : (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Nenhuma instância encontrada na UAZAPI.
              </p>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-border pt-3">
            <Button variant="ghost" size="sm" onClick={loadInstances} disabled={loading}>
              <RefreshCw className="size-3.5" />
              Atualizar lista
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setManualOpen((v) => !v)}>
              {manualOpen ? 'Cancelar token manual' : 'Colar token manualmente'}
            </Button>
          </div>

          {manualOpen && (
            <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
              <div className="space-y-1.5">
                <Label className="text-muted-foreground">Nome (opcional)</Label>
                <Input
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  placeholder="ex.: cliente-x"
                  className="bg-muted border-border text-foreground"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-muted-foreground">Token da instância</Label>
                <Input
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  placeholder="Token gerado na UAZAPI"
                  className="bg-muted border-border text-foreground"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-muted-foreground">
                  URL do servidor (opcional — usa a padrão se vazio)
                </Label>
                <Input
                  value={manualUrl}
                  onChange={(e) => setManualUrl(e.target.value)}
                  placeholder="https://seuservidor.uazapi.com"
                  className="bg-muted border-border text-foreground"
                />
              </div>
              <Button
                className="w-full"
                disabled={manualSubmitting || !manualToken.trim()}
                onClick={() =>
                  assign('manual', {
                    token: manualToken.trim(),
                    name: manualName.trim(),
                    baseUrl: manualUrl.trim(),
                  })
                }
              >
                {manualSubmitting && <Loader2 className="size-4 animate-spin" />}
                Definir com este token
              </Button>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
