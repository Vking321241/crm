'use client';

import { useMemo, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { SettingsRail } from '@/components/settings/settings-rail';
import { SettingsOverview } from '@/components/settings/settings-overview';
import { ProfileForm } from '@/components/settings/profile-form';
import { SecurityPanel } from '@/components/settings/security-panel';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { QuickRepliesManager } from '@/components/settings/quick-replies-manager';
import { AutoReplySettings } from '@/components/settings/auto-reply-settings';
import { DepartmentManager } from '@/components/settings/department-manager';
import { FieldsAndTagsPanel } from '@/components/settings/fields-and-tags-panel';
import { DealsSettings } from '@/components/settings/deals-settings';
import { MembersTab } from '@/components/settings/members-tab';
import { PermissionsMatrix } from '@/components/settings/permissions-matrix';
import { SubscriptionPanel } from '@/components/settings/subscription-panel';
import {
  resolveSection,
  visibleSections,
  type SettingsSection,
} from '@/components/settings/settings-sections';

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { defaultCurrency, canEditSettings, profileLoading } = useAuth();
  const { mode } = useTheme();
  const t = useTranslations('Settings');

  // The URL (`?tab=`) is the single source of truth for the active
  // section — deep-linkable, and it keeps the existing links in the
  // app sidebar/header working. Legacy tab values (tags, custom-fields)
  // resolve onto their new home; unknown/empty → the Overview landing.
  // Non-admin members ("atendente") only manage their own account —
  // a direct ?tab=whatsapp (or any workspace section) falls back to
  // their profile instead, mirroring the rail's own filtering
  // (visibleSections) so URL-guessing can't reach an admin-only panel.
  const requestedSection = resolveSection(searchParams.get('tab'));
  const allowed = visibleSections(canEditSettings);
  const section: SettingsSection = profileLoading
    ? requestedSection
    : allowed.includes(requestedSection)
      ? requestedSection
      : 'profile';

  const go = (next: SettingsSection) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', next);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

  // Cheap, fetch-free rail hints. The Overview landing carries the
  // full live status/counts; the rail just surfaces the two that are
  // already in context.
  const hints: Partial<Record<SettingsSection, ReactNode>> = useMemo(
    () => ({
      appearance: mode.charAt(0).toUpperCase() + mode.slice(1),
      deals: defaultCurrency,
    }),
    [mode, defaultCurrency],
  );

  const panel: Record<SettingsSection, ReactNode> = {
    overview: <SettingsOverview onSelect={go} />,
    profile: <ProfileForm />,
    security: <SecurityPanel />,
    appearance: <AppearancePanel />,
    whatsapp: <WhatsAppConfig />,
    'quick-replies': <QuickRepliesManager />,
    'auto-reply': <AutoReplySettings />,
    fields: <FieldsAndTagsPanel />,
    departments: <DepartmentManager />,
    deals: <DealsSettings />,
    members: <MembersTab />,
    permissions: <PermissionsMatrix />,
    subscription: <SubscriptionPanel />,
  };

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {t('pageTitle')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('pageDesc')}
        </p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[236px_minmax(0,1fr)] lg:items-start">
        <SettingsRail active={section} onSelect={go} hints={hints} />
        <div className="min-w-0">{panel[section]}</div>
      </div>
    </div>
  );
}
