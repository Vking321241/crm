'use client';

// ============================================================
// UazapiConfigCard — platform-wide UAZAPI server URL + admin token,
// editable from /admin instead of being locked to env vars. Every
// "Definir instância" flow on a client's page depends on this being
// set first.
// ============================================================

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, PlugZap, Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export function UazapiConfigCard() {
  const [serverUrl, setServerUrl] = useState('');
  const [adminToken, setAdminToken] = useState('');
  const [hasAdminToken, setHasAdminToken] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/admin/uazapi-config', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        setServerUrl(data.serverUrl ?? '');
        setHasAdminToken(!!data.hasAdminToken);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    if (!serverUrl.trim()) {
      toast.error('Informe a URL do servidor UAZAPI.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/uazapi-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverUrl: serverUrl.trim(),
          ...(adminToken.trim() ? { adminToken: adminToken.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Falha ao salvar');
        return;
      }
      toast.success('Configuração da UAZAPI salva');
      if (adminToken.trim()) {
        setHasAdminToken(true);
        setAdminToken('');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <PlugZap className="size-4" />
          Configuração da UAZAPI
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          URL do servidor e admin token usados para criar, listar e gerenciar as instâncias de
          todos os clientes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">URL do servidor</Label>
              <Input
                placeholder="https://seuservidor.uazapi.com"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                className="bg-muted border-border text-foreground"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">Admin token</Label>
              <Input
                type="password"
                placeholder={hasAdminToken ? '•••••••••••••• (já configurado)' : 'Token admin da UAZAPI'}
                value={adminToken}
                onChange={(e) => setAdminToken(e.target.value)}
                className="bg-muted border-border text-foreground"
              />
              <p className="text-xs text-muted-foreground">
                Deixe em branco para manter o token atual — só é necessário digitar de novo se
                quiser trocá-lo.
              </p>
            </div>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Salvar
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
