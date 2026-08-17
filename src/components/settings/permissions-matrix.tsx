'use client';

// ============================================================
// PermissionsMatrix — Settings → Permissões
//
// Table of every non-owner member x every module, a checkbox per
// cell. Owner/admin rows aren't listed here at all — they always
// have full access (see src/lib/auth/permissions.ts), so a matrix
// row for them would just be all-checked-and-disabled noise.
//
// Each checkbox click PATCHes that single cell immediately
// (optimistic, reverts on failure) — no separate "Save" step, same
// interaction as the role Select in MembersTab.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { RequireRole } from '@/components/auth/require-role';
import type { AccountRole } from '@/lib/auth/roles';
import { SettingsPanelHead } from './settings-panel-head';
import { ROLE_META } from './role-meta';

interface ModuleMeta {
  key: string;
  label: string;
  description: string;
}

interface MatrixMember {
  user_id: string;
  full_name: string;
  email: string | null;
  role: AccountRole;
  full_access: boolean;
  granted_modules: string[];
}

export function PermissionsMatrix() {
  const tRoles = useTranslations('Settings.roles');
  const [members, setMembers] = useState<MatrixMember[]>([]);
  const [modules, setModules] = useState<ModuleMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingCell, setPendingCell] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/account/permissions', { cache: 'no-store' });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Falha ao carregar permissões');
        return;
      }
      const data = (await res.json()) as { members: MatrixMember[]; modules: ModuleMeta[] };
      setMembers(data.members);
      setModules(data.modules);
    } catch (err) {
      console.error('[PermissionsMatrix] load error:', err);
      toast.error('Não foi possível conectar ao servidor.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(member: MatrixMember, moduleKey: string, next: boolean) {
    const cellId = `${member.user_id}:${moduleKey}`;
    setPendingCell(cellId);
    setMembers((prev) =>
      prev.map((m) =>
        m.user_id !== member.user_id
          ? m
          : {
              ...m,
              granted_modules: next
                ? [...m.granted_modules, moduleKey]
                : m.granted_modules.filter((k) => k !== moduleKey),
            },
      ),
    );
    try {
      const res = await fetch('/api/account/permissions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: member.user_id, module: moduleKey, canAccess: next }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Falha ao atualizar permissão');
        // revert
        setMembers((prev) =>
          prev.map((m) =>
            m.user_id !== member.user_id
              ? m
              : {
                  ...m,
                  granted_modules: next
                    ? m.granted_modules.filter((k) => k !== moduleKey)
                    : [...m.granted_modules, moduleKey],
                },
          ),
        );
      }
    } catch (err) {
      console.error('[PermissionsMatrix] toggle error:', err);
      toast.error('Não foi possível conectar ao servidor.');
    } finally {
      setPendingCell(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <RequireRole
      min="manager"
      fallback={
        <p className="text-sm text-muted-foreground">
          Apenas gerentes podem gerenciar permissões.
        </p>
      }
    >
      <section className="animate-in fade-in-50 space-y-6 duration-200">
        <SettingsPanelHead
          title="Permissões por usuário"
          description="Escolha exatamente o que cada atendente pode ver e acessar no sistema. Gerentes e o proprietário sempre têm acesso total."
        />

        {members.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8 text-center">
              <ShieldCheck className="size-6 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                Nenhum membro além do proprietário ainda.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="sticky left-0 z-10 bg-card px-4 py-3 text-left font-medium text-foreground">
                      Usuário
                    </th>
                    {modules.map((mod) => (
                      <th
                        key={mod.key}
                        className="px-3 py-3 text-center text-xs font-medium text-muted-foreground"
                        title={mod.description}
                      >
                        {mod.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {members.map((member) => {
                    const roleMeta = ROLE_META[member.role];
                    const RoleIcon = roleMeta.icon;
                    return (
                      <tr key={member.user_id}>
                        <td className="sticky left-0 z-10 bg-card px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-foreground">
                              {member.full_name || 'Sem nome'}
                            </span>
                            <span
                              className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium ${roleMeta.className}`}
                            >
                              <RoleIcon className="size-3" />
                              {tRoles(member.role)}
                            </span>
                          </div>
                          {member.email && (
                            <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                          )}
                        </td>
                        {modules.map((mod) => {
                          const cellId = `${member.user_id}:${mod.key}`;
                          const checked = member.full_access || member.granted_modules.includes(mod.key);
                          return (
                            <td key={mod.key} className="px-3 py-3 text-center">
                              <Checkbox
                                checked={checked}
                                disabled={member.full_access || pendingCell === cellId}
                                onCheckedChange={(v) => toggle(member, mod.key, v === true)}
                                aria-label={`${mod.label} — ${member.full_name}`}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-muted-foreground">
          Precisa que alguém veja Configurações do espaço de trabalho (Setores, Membros,
          WhatsApp, …)? Isso é o cargo{' '}
          <Badge className="bg-muted text-muted-foreground border-border mx-1 text-[10px]">Gerente</Badge>
          — troque em Membros da equipe, não aqui. Esta tabela só ajusta o que um Membro comum
          pode ver.
        </p>
      </section>
    </RequireRole>
  );
}
