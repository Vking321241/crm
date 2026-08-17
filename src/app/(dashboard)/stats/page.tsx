"use client"

import { useCallback, useEffect, useState } from "react"
import { Users, MessageSquare, Clock, Send, UserCog } from "lucide-react"

import type {
  ActivityItem,
  AgentStat,
  ContactsGrowthPoint,
  ConversationsSeriesPoint,
  ConversationStatusBreakdown,
  MetricsBundle,
  ResponseTimeSummary,
} from "@/lib/dashboard/types"

import { MetricCard } from "@/components/dashboard/metric-card"
import { SkeletonCard } from "@/components/dashboard/skeleton"
import { Skeleton } from "@/components/dashboard/skeleton"
import { EmptyState } from "@/components/dashboard/empty-state"
import { ResponseTimeChart } from "@/components/dashboard/response-time-chart"
import { ActivityFeed } from "@/components/dashboard/activity-feed"
import { BarChart } from "@/components/tremor/bar-chart"
import { AdvancedAnalyticsSection } from "@/components/dashboard/advanced-analytics"
import { TransferHistorySection } from "@/components/dashboard/transfer-history-section"
import { useAuth } from "@/hooks/use-auth"

interface StatsPayload {
  metrics: MetricsBundle
  contactsGrowth: ContactsGrowthPoint[]
  conversationsSeries: ConversationsSeriesPoint[]
  statusBreakdown: ConversationStatusBreakdown
  responseTime: ResponseTimeSummary
  agents: AgentStat[]
  activity: ActivityItem[]
}

function formatMinutes(mins: number | null): string {
  if (mins == null) return "—"
  if (mins < 60) return `${Math.round(mins)} min`
  return `${(mins / 60).toFixed(1)} h`
}

function shortDayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
}

export default function StatsPage() {
  const { hasPermission, profileLoading } = useAuth()
  const [data, setData] = useState<StatsPayload | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    fetch("/api/stats?rangeDays=30")
      .then((res) => {
        if (!res.ok) throw new Error("stats fetch failed")
        return res.json() as Promise<StatsPayload>
      })
      .then(setData)
      .catch((err) => console.error("[stats] load failed:", err))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const totalConversations = data
    ? data.statusBreakdown.open + data.statusBreakdown.pending + data.statusBreakdown.closed
    : 0

  const contactsChartData =
    data?.contactsGrowth.map((p) => ({ day: shortDayLabel(p.day), "Novos contatos": p.count })) ?? []

  const messagesChartData =
    data?.conversationsSeries.map((p) => ({
      day: shortDayLabel(p.day),
      Recebidas: p.incoming,
      Enviadas: p.outgoing,
    })) ?? []

  if (!profileLoading && !hasPermission("reports")) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Você não tem acesso aos relatórios. Peça a um gerente para liberar em
          Configurações → Permissões.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Estatísticas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Contatos e atendimentos dos últimos 30 dias.
        </p>
      </div>

      <AdvancedAnalyticsSection />

      {/* Metric cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading || !data ? (
          Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          <>
            <MetricCard
              title="Conversas ativas"
              value={data.metrics.activeConversations.current.toLocaleString()}
              icon={MessageSquare}
              subtitle={`${totalConversations} no total`}
            />
            <MetricCard
              title="Novos contatos hoje"
              value={data.metrics.newContactsToday.current.toLocaleString()}
              icon={Users}
            />
            <MetricCard
              title="Tempo médio de atendimento"
              value={formatMinutes(data.statusBreakdown.avgHandlingMinutes)}
              icon={Clock}
              subtitle={`${data.statusBreakdown.closed} conversas encerradas`}
            />
            <MetricCard
              title="Mensagens enviadas hoje"
              value={data.metrics.messagesSentToday.current.toLocaleString()}
              icon={Send}
            />
          </>
        )}
      </div>

      {/* Status breakdown */}
      <section className="rounded-xl border border-border bg-card">
        <header className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Status dos atendimentos</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Distribuição das conversas por status atual.
          </p>
        </header>
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-3">
          {loading || !data ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
          ) : (
            <>
              <StatusTile label="Abertas" count={data.statusBreakdown.open} tone="ok" />
              <StatusTile label="Pendentes" count={data.statusBreakdown.pending} tone="muted" />
              <StatusTile label="Encerradas" count={data.statusBreakdown.closed} tone="closed" />
            </>
          )}
        </div>
      </section>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card">
          <header className="border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold text-foreground">Novos contatos</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Contatos criados por dia.</p>
          </header>
          <div className="p-5">
            {loading || !data ? (
              <Skeleton className="h-[260px] w-full" />
            ) : data.contactsGrowth.every((p) => p.count === 0) ? (
              <EmptyState icon={Users} title="Sem contatos novos" hint="Nenhum contato criado no período." />
            ) : (
              <BarChart
                data={contactsChartData}
                index="day"
                categories={["Novos contatos"]}
                colors={["blue"]}
                showLegend={false}
                yAxisWidth={40}
                className="h-[260px]"
              />
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card">
          <header className="border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold text-foreground">Mensagens</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Recebidas x enviadas por dia.</p>
          </header>
          <div className="p-5">
            {loading || !data ? (
              <Skeleton className="h-[260px] w-full" />
            ) : messagesChartData.every((p) => p.Recebidas === 0 && p.Enviadas === 0) ? (
              <EmptyState icon={MessageSquare} title="Sem mensagens" hint="Nenhuma mensagem no período." />
            ) : (
              <BarChart
                data={messagesChartData}
                index="day"
                categories={["Recebidas", "Enviadas"]}
                colors={["blue", "violet"]}
                yAxisWidth={40}
                className="h-[260px]"
              />
            )}
          </div>
        </section>
      </div>

      {/* Response time */}
      <ResponseTimeChart data={data?.responseTime ?? null} loading={loading} />

      {/* Per-agent breakdown */}
      <section className="rounded-xl border border-border bg-card">
        <header className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Atendimentos por atendente</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Conversas atribuídas a cada membro da equipe.
          </p>
        </header>
        <div className="p-5">
          {loading || !data ? (
            <Skeleton className="h-40 w-full" />
          ) : data.agents.length === 0 ? (
            <EmptyState
              icon={UserCog}
              title="Sem conversas atribuídas"
              hint="Assim que uma conversa for atribuída a alguém, ela aparece aqui."
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Atendente</th>
                    <th className="px-4 py-2 font-medium">Abertas</th>
                    <th className="px-4 py-2 font-medium">Encerradas</th>
                    <th className="px-4 py-2 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.agents.map((a) => (
                    <tr key={a.agentId}>
                      <td className="px-4 py-2 font-medium text-foreground">{a.name}</td>
                      <td className="px-4 py-2 text-muted-foreground">{a.openCount}</td>
                      <td className="px-4 py-2 text-muted-foreground">{a.closedCount}</td>
                      <td className="px-4 py-2 text-foreground">{a.totalCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Recent activity — ported over from the old Painel dashboard
          page when Painel/Pipeline/Negócios were removed. */}
      <ActivityFeed items={data?.activity ?? null} loading={loading} />

      <TransferHistorySection />
    </div>
  )
}

function StatusTile({
  label,
  count,
  tone,
}: {
  label: string
  count: number
  tone: "ok" | "muted" | "closed"
}) {
  const toneClass =
    tone === "ok"
      ? "text-primary"
      : tone === "muted"
      ? "text-amber-400"
      : "text-muted-foreground"
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${toneClass}`}>{count}</p>
    </div>
  )
}
