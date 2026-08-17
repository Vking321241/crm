"use client"

import { useEffect, useState } from "react"
import { Star } from "lucide-react"

import { EmptyState } from "@/components/dashboard/empty-state"
import { Skeleton } from "@/components/dashboard/skeleton"

interface CsatAgentStat {
  agentId: string
  name: string
  avgRating: number
  responseCount: number
}

interface CsatStats {
  totalResponses: number
  avgRating: number | null
  distribution: number[]
  byAgent: CsatAgentStat[]
}

/**
 * "Pesquisa de satisfação" — aggregates the 1-5 replies customers
 * send after the "Enviar nota para atendimento" close flow.
 */
export function CsatReport() {
  const [data, setData] = useState<CsatStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/stats/csat?rangeDays=30", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("csat fetch failed")
        return res.json() as Promise<CsatStats>
      })
      .then(setData)
      .catch((err) => console.error("[csat-report] load failed:", err))
      .finally(() => setLoading(false))
  }, [])

  const maxCount = data ? Math.max(1, ...data.distribution) : 1

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold text-foreground">Pesquisa de satisfação</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Notas de 1 a 5 respondidas pelos clientes ao encerrar o atendimento, últimos 30 dias.
        </p>
      </header>
      <div className="p-5">
        {loading || !data ? (
          <Skeleton className="h-[220px] w-full" />
        ) : data.totalResponses === 0 ? (
          <EmptyState
            icon={Star}
            title="Sem avaliações ainda"
            hint='Envie a pesquisa ao encerrar um atendimento ("Enviar nota para atendimento") para começar a coletar notas.'
          />
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[auto_1fr]">
            <div className="flex flex-col items-center justify-center rounded-lg border border-border px-6 py-4">
              <span className="text-3xl font-bold tabular-nums text-foreground">
                {data.avgRating!.toFixed(1)}
              </span>
              <div className="mt-1 flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star
                    key={n}
                    className={
                      n <= Math.round(data.avgRating!)
                        ? "size-3.5 fill-amber-400 text-amber-400"
                        : "size-3.5 text-muted-foreground"
                    }
                  />
                ))}
              </div>
              <span className="mt-1 text-xs text-muted-foreground">
                {data.totalResponses} {data.totalResponses === 1 ? "avaliação" : "avaliações"}
              </span>
            </div>

            <div className="space-y-1.5">
              {[5, 4, 3, 2, 1].map((rating) => {
                const count = data.distribution[rating - 1]
                const pct = (count / maxCount) * 100
                return (
                  <div key={rating} className="flex items-center gap-2 text-xs">
                    <span className="w-3 shrink-0 text-right tabular-nums text-muted-foreground">
                      {rating}
                    </span>
                    <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-amber-400"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-6 shrink-0 tabular-nums text-muted-foreground">{count}</span>
                  </div>
                )
              })}
            </div>

            {data.byAgent.length > 0 && (
              <div className="lg:col-span-2">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Por atendente
                </p>
                <div className="space-y-1.5">
                  {data.byAgent.map((a) => (
                    <div key={a.agentId} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate text-foreground">{a.name}</span>
                      <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
                        <Star className="size-3 fill-amber-400 text-amber-400" />
                        {a.avgRating.toFixed(1)}
                        <span className="text-xs">({a.responseCount})</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
