'use client';

// ============================================================
// Client-facing WhatsApp settings — deliberately just the QR connect
// flow. Instance/token/webhook internals are platform-owner concerns
// (see /admin/[accountId] → "Definir instância"), never shown here —
// a tenant admin only needs to know "scan this to connect".
// ============================================================

import { ConnectInstanceCard } from '@/components/whatsapp/connect-instance-card';
import { SettingsPanelHead } from './settings-panel-head';

export function WhatsAppConfig() {
  return (
    <section className="max-w-2xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="WhatsApp"
        description="Conecte o WhatsApp do cliente pelo QR code."
      />

      <ConnectInstanceCard />
    </section>
  );
}
