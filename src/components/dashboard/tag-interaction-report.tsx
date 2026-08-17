"use client"

import { useCallback, useEffect, useState } from "react"
import { Tag as TagIcon } from "lucide-react"

import { BarChart } from "@/components/tremor/bar-chart"
import { EmptyState } from "@/components/dashboard/empty-state"
import { Skeleton } from "@/components/dashboard/skeleton"

interface TagStat {
  tagId: string
  tagName: string
  tagColor: string
  contactCount: number
}

interface TagsPayload {
  month: string
  stats: TagStat[]
}

function monthOptions(count: number): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = []
  const now = new Date()
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    const label = d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
    options.push({ value, label: label.charAt(0).toUpperCase() + label.slice(1) })
  }
  return options
}

/**
 * "Interação por etiqueta de produto" — a bar chart of which tag
 * (defined by the account as a product/service line — everything in
 * Configurações → Etiquetas except the auto-managed "Grupo" tag) had
 * the most distinct contacts interact with it in a given month.
 */
export function TagInteractionReport() {
  const options = monthOptions(12)
  const [month, setMonth] = useState(options[0].value)
  const [data, setData] = useState<TagsPayload | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback((m: string) => {
    setLoading(true)
    fetch(`/api/stats/tags?month=${m}`, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("tag stats fetch failed")
        return res.json() as Promise<TagsPayload>
      })
      .then(setData)
      .catch((err) => console.error("[tag-interaction-report] load failed:", err))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load(month)
  }, [month, load])

  const chartData = data?.stats.map((s) => ({ etiqueta: s.tagName, "Contatos únicos": s.contactCount })) ?? []
  const hasAnyTag = (data?.stats.length ?? 0) > 0
  const hasAnyInteraction = data?.stats.some((s) => s.contactCount > 0) ?? false

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Interação por etiqueta de produto</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Contatos únicos que trocaram mensagem no mês, por etiqueta.
          </p>
        </div>
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="h-8 rounded-md border border-border bg-muted px-2.5 text-xs text-foreground outline-none focus:border-primary/50"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </header>
      <div className="p-5">
        {loading || !data ? (
          <Skeleton className="h-[260px] w-full" />
        ) : !hasAnyTag ? (
          <EmptyState
            icon={TagIcon}
            title="Nenhuma etiqueta cadastrada"
            hint="Crie etiquetas em Configurações → Etiquetas para identificar seus produtos."
          />
        ) : !hasAnyInteraction ? (
          <EmptyState icon={TagIcon} title="Sem interação no período" hint="Nenhum contato com etiqueta trocou mensagem nesse mês." />
        ) : (
          <BarChart
            data={chartData}
            index="etiqueta"
            categories={["Contatos únicos"]}
            colors={["violet"]}
            showLegend={false}
            yAxisWidth={40}
            className="h-[260px]"
          />
        )}
      </div>
    </section>
  )
}
