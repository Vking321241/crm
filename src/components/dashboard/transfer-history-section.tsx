'use client';

// ============================================================
// TransferHistorySection — "quem transferiu pra quem e quantas
// vezes" report. Only reachable at all from pages gated behind the
// "reports" permission (Estatísticas), which already matches the
// client's ask: only the owner or a manager (granted reports) sees
// this, a plain atendente never does. The API route
// (GET /api/conversations/transfers) re-enforces the same gate
// server-side via requireModule("reports").
// ============================================================

import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ArrowRightLeft, Loader2 } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

interface TransferEntry {
  id: string;
  contact_name: string;
  from_agent: { id: string; name: string } | null;
  to_agent: { id: string; name: string } | null;
  from_department: { id: string; name: string } | null;
  to_department: { id: string; name: string } | null;
  created_at: string;
}

interface TransferSummary {
  from: string;
  to: string;
  count: number;
}

export function TransferHistorySection() {
  const [transfers, setTransfers] = useState<TransferEntry[] | null>(null);
  const [summary, setSummary] = useState<TransferSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/conversations/transfers?limit=50', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        setTransfers(data.transfers ?? []);
        setSummary(data.summary ?? []);
      })
      .catch(() => setTransfers([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="border-b border-border px-5 py-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ArrowRightLeft className="size-4" />
          Histórico de transferências
        </h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Visível apenas para quem tem acesso a Relatórios — quem transferiu para quem e quantas
          vezes.
        </p>
      </header>
      <div className="p-5">
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : !transfers || transfers.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhuma transferência registrada ainda.
          </p>
        ) : (
          <div className="space-y-5">
            {summary.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {summary.map((s) => (
                  <span
                    key={`${s.from}-${s.to}`}
                    className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-foreground"
                  >
                    {s.from} <ArrowRightLeft className="size-3 text-muted-foreground" /> {s.to}
                    <span className="ml-1 rounded-full bg-primary/15 px-1.5 text-[10px] font-bold text-primary">
                      {s.count}
                    </span>
                  </span>
                ))}
              </div>
            )}

            <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted text-left text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Contato</th>
                    <th className="px-3 py-2 font-medium">De</th>
                    <th className="px-3 py-2 font-medium">Para</th>
                    <th className="px-3 py-2 font-medium">Quando</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {transfers.map((t) => (
                    <tr key={t.id}>
                      <td className="px-3 py-2 text-foreground">{t.contact_name}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {t.from_agent?.name ?? t.from_department?.name ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {t.to_agent?.name ?? t.to_department?.name ?? 'Fila'}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {formatDistanceToNow(new Date(t.created_at), { addSuffix: true, locale: ptBR })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
