import {
  Coins,
  LayoutGrid,
  MessageSquareText,
  Palette,
  PlugZap,
  Shield,
  ShieldCheck,
  Tags,
  User,
  Users2,
  UsersRound,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * Settings information architecture for the redesigned page.
 *
 * The flat tab strip became a grouped left rail with a new Overview
 * landing. The URL query param stays `?tab=` (deep-linkable, and it
 * keeps the existing links in sidebar.tsx / header.tsx working) — we
 * just map the old values onto the new sections.
 */
export const SETTINGS_SECTIONS = [
  'overview',
  'profile',
  'security',
  'appearance',
  'whatsapp',
  'quick-replies',
  'auto-reply',
  'fields',
  'departments',
  'deals',
  'members',
  'permissions',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const DEFAULT_SECTION: SettingsSection = 'overview';

/**
 * Non-admin members ("atendente") only manage their own account —
 * profile, login/security, and appearance. Everything workspace-wide
 * (WhatsApp, mensagens prontas, setores, membros, permissões, …) is
 * admin+ only, both as a UI affordance (hidden from the rail — see
 * `visibleSections`) and enforced server-side by each route's own
 * `requireRole`/`requireModule` guard. A member who checks every
 * permission module ("gerente") still doesn't get Settings access —
 * modules gate app screens (inbox, spy mode, reports, …), not the
 * account-wide configuration surface, which stays a role boundary.
 */
export const ACCOUNT_ONLY_SECTIONS: readonly SettingsSection[] = [
  'profile',
  'security',
  'appearance',
];

export function visibleSections(isAdmin: boolean): readonly SettingsSection[] {
  return isAdmin ? SETTINGS_SECTIONS : ACCOUNT_ONLY_SECTIONS;
}

/** Rail grouping. `adminOnly` items are hidden for non-admins. */
export interface SectionMeta {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  group: 'top' | 'account' | 'workspace';
}

export const SECTION_META: Record<SettingsSection, SectionMeta> = {
  overview: { id: 'overview', label: 'Overview', icon: LayoutGrid, group: 'top' },
  profile: { id: 'profile', label: 'Your profile', icon: User, group: 'account' },
  security: { id: 'security', label: 'Login & security', icon: Shield, group: 'account' },
  appearance: { id: 'appearance', label: 'Appearance', icon: Palette, group: 'account' },
  whatsapp: { id: 'whatsapp', label: 'WhatsApp', icon: PlugZap, group: 'workspace' },
  'quick-replies': { id: 'quick-replies', label: 'Quick replies', icon: Zap, group: 'workspace' },
  'auto-reply': { id: 'auto-reply', label: 'Mensagens automáticas', icon: MessageSquareText, group: 'workspace' },
  fields: { id: 'fields', label: 'Fields & tags', icon: Tags, group: 'workspace' },
  departments: { id: 'departments', label: 'Setores', icon: Users2, group: 'workspace' },
  deals: { id: 'deals', label: 'Deals & currency', icon: Coins, group: 'workspace' },
  members: { id: 'members', label: 'Team members', icon: UsersRound, group: 'workspace' },
  permissions: { id: 'permissions', label: 'Permissões', icon: ShieldCheck, group: 'workspace' },
};

export const RAIL_GROUPS: { label: string | null; group: SectionMeta['group'] }[] = [
  { label: null, group: 'top' },
  { label: 'Account', group: 'account' },
  { label: 'Workspace', group: 'workspace' },
];

function isSection(value: string | null): value is SettingsSection {
  return !!value && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/**
 * Resolve a raw `?tab=` value to a section. Legacy tabs from the old
 * flat layout collapse onto their new home (Tags + Custom fields → the
 * merged "Fields & tags" section). Anything unknown falls back to the
 * Overview landing.
 */
export function resolveSection(raw: string | null): SettingsSection {
  if (raw === 'tags' || raw === 'custom-fields') return 'fields';
  if (isSection(raw)) return raw;
  return DEFAULT_SECTION;
}
