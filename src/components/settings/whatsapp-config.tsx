'use client';

import { ConnectInstanceCard } from '@/components/whatsapp/connect-instance-card';
import { Card, CardContent } from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';

export function WhatsAppConfig() {
  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="WhatsApp"
        description="Conecte o WhatsApp do cliente pelo QR code. A integração usa a instância UAZAPI provisionada no Postgres deste CRM."
      />

      <div className="space-y-4">
        <ConnectInstanceCard />

        <Card className="border-border bg-card">
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              O webhook público desta instalação deve apontar para{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">
                https://talk.divary.com.br/api/whatsapp/uazapi/webhook/&lt;instanceId&gt;
              </code>
              .
            </p>
            <p>
              Quando o QR code for lido, o sistema configura esse webhook automaticamente
              usando a URL definida em <code>NEXT_PUBLIC_SITE_URL</code>.
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
