'use client';

// ============================================================
// Dashboard Analytics e Relatórios — filter bar (período,
// departamento, atendente) + KPI cards + horários de pico heatmap +
// distribuição por setor + atendimentos por atendente.
// ============================================================

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { Users, MessageSquare, Inbox, Clock, Timer, PhoneIncoming } from 'lucide-react';

import { MetricCard } from '@/components/dashboard/metric-card';
import { Skeleton } from '@/components/dashboard/skeleton';
import { BarChart } from '@/components/tremor/bar-chart';
import type { AdvancedAnalytics } from '@/lib/dashboard/types';

const DOW_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

type Preset = 'today' | '7d' | '30d' | 'month' | 'custom';

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
  { value: 'month', label: 'Este mês' },
  { value: 'custom', label: 'Personalizado' },
];

function presetRange(preset: Preset, customFrom: string, customTo: string): { from: Date; to: Date } {
  const now = new Date();
  const startOfDay = (d: Date) => {
    const out = new Date(d);
    out.setHours(0, 0, 0, 0);
    return out;
  };
  switch (preset) {
    case 'today':
      return { from: startOfDay(now), to: now };
    case '7d': {
      const from = startOfDay(now);
      from.setDate(from.getDate() - 6);
      return { from, to: now };
    }
    case '30d': {
      const from = startOfDay(now);
      from.setDate(from.getDate() - 29);
      return { from, to: now };
    }
    case 'month': {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from, to: now };
    }
    case 'custom':
      return {
        from: customFrom ? new Date(customFrom) : startOfDay(now),
        to: customTo ? new Date(customTo) : now,
      };
  }
}

function formatMinutes(mins: number | null): string {
  if (mins == null) return '—';
  if (mins < 60) return `${Math.round(mins)} min`;
  return `${(mins / 60).toFixed(1)} h`;
}

function heatColor(count: number, max: number): string {
  if (count === 0 || max === 0) return 'bg-muted';
  const intensity = count / max;
  if (intensity > 0.75) return 'bg-primary';
  if (intensity > 0.5) return 'bg-primary/70';
  if (intensity > 0.25) return 'bg-primary/40';
  return 'bg-primary/20';
}

interface DepartmentLite {
  id: string;
  name: string;
  color: string;
}
interface MemberLite {
  user_id: string;
  full_name: string;
}

export function AdvancedAnalyticsSection() {
  const [preset, setPreset] = useState<Preset>('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [departments, setDepartments] = useState<DepartmentLite[]>([]);
  const [members, setMembers] = useState<MemberLite[]>([]);
  const [data, setData] = useState<AdvancedAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/departments', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setDepartments(d.departments ?? []))
      .catch(() => {});
    fetch('/api/account/members', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setMembers(d.members ?? []))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { from, to } = presetRange(preset, customFrom, customTo);
    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
    });
    if (departmentId) params.set('departmentId', departmentId);
    if (agentId) params.set('agentId', agentId);
    try {
      const res = await fetch(`/api/stats/advanced?${params.toString()}`, { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        setData(json.analytics as AdvancedAnalytics);
      }
    } finally {
      setLoading(false);
    }
  }, [preset, customFrom, customTo, departmentId, agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const maxHeat = useMemo(() => Math.max(0, ...(data?.heatmap.map((c) => c.count) ?? [0])), [data]);
  const heatmapByCell = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of data?.heatmap ?? []) map.set(`${c.dow}-${c.hour}`, c.count);
    return map;
  }, [data]);

  const agentChartData = useMemo(
    () => (data?.agentBreakdown ?? []).map((a) => ({ name: a.name, Atendimentos: a.totalCount })),
    [data],
  );

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Dashboard Analytics e Relatórios</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Métricas filtráveis por período, departamento e atendente.
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPreset(p.value)}
              className={
                preset === p.value
                  ? 'rounded-md bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary'
                  : 'rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted'
              }
            >
              {p.label}
            </button>
          ))}
        </div>

        {preset === 'custom' && (
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-md border border-border bg-muted px-2 py-1.5 text-xs text-foreground"
            />
            <span className="text-xs text-muted-foreground">até</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-md border border-border bg-muted px-2 py-1.5 text-xs text-foreground"
            />
          </div>
        )}

        <div className="ml-auto flex flex-wrap gap-2">
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="rounded-md border border-border bg-muted px-2 py-1.5 text-xs text-foreground"
          >
            <option value="">Todos os departamentos</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="rounded-md border border-border bg-muted px-2 py-1.5 text-xs text-foreground"
          >
            <option value="">Todos os atendentes</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.full_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {loading || !data ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)
        ) : (
          <>
            <MetricCard
              title="Contatos totais na base"
              value={data.totalContactsInBase.toLocaleString()}
              icon={Users}
            />
            <MetricCard
              title="Atendimentos no período"
              value={data.totalConversationsInPeriod.toLocaleString()}
              icon={MessageSquare}
              subtitle={`${data.receptiveCount} receptivos · ${data.activeCount} ativos`}
            />
            <MetricCard
              title="Atendimentos pendentes"
              value={data.pendingCount.toLocaleString()}
              icon={Inbox}
            />
            <MetricCard
              title="Tempo médio de atendimento"
              value={formatMinutes(data.avgHandlingMinutes)}
              icon={Timer}
            />
            <MetricCard
              title="Tempo médio de resposta"
              value={formatMinutes(data.avgResponseMinutes)}
              icon={Clock}
            />
          </>
        )}
      </div>

      {/* Receptivo vs Ativo */}
      {!loading && data && data.totalConversationsInPeriod > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
          <PhoneIncoming className="size-4 text-muted-foreground" />
          <div className="flex-1">
            <div className="flex h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="bg-primary"
                style={{
                  width: `${(data.receptiveCount / data.totalConversationsInPeriod) * 100}%`,
                }}
              />
              <div
                className="bg-amber-500"
                style={{
                  width: `${(data.activeCount / data.totalConversationsInPeriod) * 100}%`,
                }}
              />
            </div>
            <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
              <span>Receptivos: {data.receptiveCount}</span>
              <span>Ativos: {data.activeCount}</span>
            </div>
          </div>
        </div>
      )}

      {/* Heatmap + department pie */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card">
          <header className="border-b border-border px-5 py-4">
            <h3 className="text-sm font-semibold text-foreground">Mapa do Atendimento</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Horários de pico — dias da semana × horas do dia.
            </p>
          </header>
          <div className="overflow-x-auto p-4">
            {loading || !data ? (
              <Skeleton className="h-48 w-full" />
            ) : (
              <div className="inline-block min-w-full">
                <div className="grid grid-cols-[32px_repeat(24,1fr)] gap-0.5">
                  <div />
                  {Array.from({ length: 24 }).map((_, h) => (
                    <div key={h} className="text-center text-[8px] text-muted-foreground">
                      {h % 3 === 0 ? h : ''}
                    </div>
                  ))}
                  {DOW_LABELS.map((label, dow) => (
                    <Fragment key={dow}>
                      <div className="text-[10px] text-muted-foreground">{label}</div>
                      {Array.from({ length: 24 }).map((_, hour) => {
                        const count = heatmapByCell.get(`${dow}-${hour}`) ?? 0;
                        return (
                          <div
                            key={`${dow}-${hour}`}
                            title={`${label} ${hour}h — ${count} mensagens`}
                            className={`size-3 rounded-sm sm:size-4 ${heatColor(count, maxHeat)}`}
                          />
                        );
                      })}
                    </Fragment>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card">
          <header className="border-b border-border px-5 py-4">
            <h3 className="text-sm font-semibold text-foreground">Atendimentos por departamento</h3>
          </header>
          <div className="p-5">
            {loading || !data ? (
              <Skeleton className="h-64 w-full" />
            ) : data.departmentBreakdown.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Sem dados no período.</p>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={data.departmentBreakdown}
                      dataKey="count"
                      nameKey="name"
                      innerRadius={50}
                      outerRadius={90}
                      paddingAngle={2}
                    >
                      {data.departmentBreakdown.map((d) => (
                        <Cell key={d.id ?? 'none'} fill={d.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
            {!loading && data && data.departmentBreakdown.length > 0 && (
              <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1">
                {data.departmentBreakdown.map((d) => (
                  <span key={d.id ?? 'none'} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="size-2 rounded-full" style={{ backgroundColor: d.color }} />
                    {d.name} ({d.count})
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Agent bar chart */}
      <section className="rounded-xl border border-border bg-card">
        <header className="border-b border-border px-5 py-4">
          <h3 className="text-sm font-semibold text-foreground">Comparativo por atendente</h3>
        </header>
        <div className="p-5">
          {loading || !data ? (
            <Skeleton className="h-64 w-full" />
          ) : agentChartData.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Sem dados no período.</p>
          ) : (
            <BarChart
              data={agentChartData}
              index="name"
              categories={['Atendimentos']}
              colors={['blue']}
              showLegend={false}
              yAxisWidth={40}
              className="h-64"
            />
          )}
        </div>
      </section>
    </section>
  );
}
