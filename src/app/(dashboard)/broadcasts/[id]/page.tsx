'use client';

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Broadcast, BroadcastRecipient, RecipientStatus } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ArrowLeft,
  Loader2,
  Users,
  Send,
  AlertCircle,
  Filter,
  Download,
  ChevronDown,
  Trash2,
  ImageIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getBroadcastStatus,
  getRecipientStatus,
} from '@/lib/broadcast-status';
import { useTranslations } from 'next-intl';

/** Poll cadence while the broadcast is actively sending. */
const POLL_INTERVAL_MS = 3_000;

interface StatCardProps {
  label: string;
  value: number;
  total: number;
  icon: React.ReactNode;
  color: string;
}

function StatCard({ label, value, total, icon, color }: StatCardProps) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}>
          {icon}
        </div>
        <span className="text-xs text-muted-foreground">{pct}%</span>
      </div>
      <p className="mt-3 text-2xl font-bold text-foreground">{value.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

const RECIPIENT_STATUSES: readonly RecipientStatus[] = [
  'pending',
  'sent',
  'delivered',
  'read',
  'replied',
  'failed',
];

/** CSV export helper — RFC 4180 quoting. */
function toCsv(rows: string[][]): string {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return rows.map((r) => r.map(escape).join(',')).join('\n');
}

function downloadBlob(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function BroadcastDetailPage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations('Broadcasts.detail');
  const tStatus = useTranslations('Broadcasts.status');
  const broadcastId = params.id as string;

  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);
  const [recipients, setRecipients] = useState<BroadcastRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<RecipientStatus | 'all'>('all');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sending, setSending] = useState(false);

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/broadcasts/${broadcastId}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t('notFound'));
      setBroadcast(data.broadcast);
      setRecipients(data.recipients ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('notFound'));
    } finally {
      setLoading(false);
    }
  }, [broadcastId, t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    function stopPolling() {
      if (!pollTimer.current) return;
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    if (broadcast?.status === 'sending') {
      if (!pollTimer.current) {
        pollTimer.current = setInterval(fetchData, POLL_INTERVAL_MS);
      }
    } else {
      stopPolling();
    }
    return stopPolling;
  }, [broadcast?.status, fetchData]);

  const filteredRecipients = useMemo(
    () =>
      statusFilter === 'all'
        ? recipients
        : recipients.filter((r) => r.status === statusFilter),
    [recipients, statusFilter],
  );

  function handleExport() {
    if (!broadcast) return;
    const header = [
      t('table.contact'),
      t('table.phone'),
      t('table.status'),
      t('table.sent'),
      t('table.error'),
    ];
    const rows = recipients.map((r) => [
      r.contact?.name ?? '',
      r.contact?.phone ?? '',
      r.status,
      r.sentAt ?? '',
      r.errorMessage ?? '',
    ]);
    const csv = toCsv([header, ...rows]);
    const safeName = broadcast.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
    downloadBlob(`broadcast-${safeName}-${broadcastId.slice(0, 8)}.csv`, csv);
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/broadcasts/${broadcastId}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to delete');
      toast.success(t('toastDeleted'));
      router.push('/broadcasts');
    } catch (err) {
      toast.error(
        t('toastFailedDelete', {
          error: err instanceof Error ? err.message : 'Unknown error',
        }),
      );
    } finally {
      setDeleting(false);
    }
  }

  async function handleSend() {
    setSending(true);
    try {
      const res = await fetch(`/api/broadcasts/${broadcastId}/send`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to start send');
      toast.success(t('toastSendStarted'));
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start send');
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !broadcast) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-red-400">{error ?? t('notFound')}</p>
        <Button variant="outline" onClick={() => router.push('/broadcasts')}>
          {t('backToBroadcasts')}
        </Button>
      </div>
    );
  }

  const status = getBroadcastStatus(broadcast.status);
  const canSend = broadcast.status === 'draft' || broadcast.status === 'failed';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            onClick={() => router.push('/broadcasts')}
            className="border-border"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">{broadcast.name}</h1>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${status.classes}`}
              >
                {tStatus(status.label)}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
              <span>
                {t('createdAt', { date: new Date(broadcast.createdAt).toLocaleDateString() })}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {canSend && (
            <Button
              size="sm"
              onClick={handleSend}
              disabled={sending}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {sending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {t('sendNow')}
            </Button>
          )}

          {confirmDelete ? (
            <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm">
              <span className="text-red-300">{t('deletePrompt')}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="h-7 border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                {t('cancel')}
              </Button>
              <Button
                size="sm"
                onClick={handleDelete}
                disabled={deleting}
                className="h-7 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? t('deleting') : t('confirm')}
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={broadcast.status !== 'draft'}
              onClick={() => setConfirmDelete(true)}
              title={broadcast.status !== 'draft' ? t('cannotDeleteSending') : t('deleteHover')}
              className="border-red-500/30 bg-transparent text-red-400 hover:bg-red-500/10 disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('delete')}
            </Button>
          )}
        </div>
      </div>

      {/* Message preview */}
      <div className="rounded-xl border border-border bg-card/50 p-4">
        <p className="mb-2 text-sm font-medium text-foreground">{t('message')}</p>
        {broadcast.mediaUrl && (
          <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <ImageIcon className="h-3.5 w-3.5" />
            <a
              href={broadcast.mediaUrl}
              target="_blank"
              rel="noreferrer"
              className="truncate text-primary hover:underline"
            >
              {broadcast.mediaUrl}
            </a>
          </div>
        )}
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">
          {broadcast.contentText}
        </p>
      </div>

      {/* Stats — Total / Sent / Failed */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label={t('stats.totalRecipients')}
          value={broadcast.totalRecipients}
          total={broadcast.totalRecipients}
          icon={<Users className="h-4 w-4" />}
          color="bg-muted text-muted-foreground"
        />
        <StatCard
          label={t('stats.sent')}
          value={broadcast.sentCount}
          total={broadcast.totalRecipients}
          icon={<Send className="h-4 w-4" />}
          color="bg-primary/10 text-primary"
        />
        <StatCard
          label={t('stats.failed')}
          value={broadcast.failedCount}
          total={broadcast.totalRecipients}
          icon={<AlertCircle className="h-4 w-4" />}
          color="bg-red-500/10 text-red-400"
        />
      </div>

      {/* Recipients Table */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium text-foreground">
            {statusFilter !== 'all'
              ? t('recipientsHeader', { filtered: filteredRecipients.length, total: recipients.length })
              : t('recipientsHeaderAll', { total: recipients.length })}
          </h2>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-border text-muted-foreground hover:bg-muted"
                  />
                }
              >
                <Filter className="h-3.5 w-3.5" />
                {statusFilter === 'all'
                  ? t('allStatuses')
                  : tStatus(getRecipientStatus(statusFilter).label)}
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent className="border-border bg-popover">
                <DropdownMenuItem
                  onClick={() => setStatusFilter('all')}
                  className={statusFilter === 'all' ? 'text-primary' : 'text-popover-foreground'}
                >
                  {t('allStatuses')}
                </DropdownMenuItem>
                {RECIPIENT_STATUSES.map((s) => (
                  <DropdownMenuItem
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={statusFilter === s ? 'text-primary' : 'text-popover-foreground'}
                  >
                    {tStatus(getRecipientStatus(s).label)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={recipients.length === 0}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              <Download className="h-3.5 w-3.5" />
              {t('exportCsv')}
            </Button>
          </div>
        </div>

        {filteredRecipients.length === 0 ? (
          <div className="flex h-32 items-center justify-center">
            <p className="text-sm text-muted-foreground">
              {recipients.length === 0 ? t('noRecipients') : t('noRecipientsFilter')}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-border hover:bg-transparent">
                  <TableHead className="text-muted-foreground">{t('table.contact')}</TableHead>
                  <TableHead className="text-muted-foreground">{t('table.phone')}</TableHead>
                  <TableHead className="text-muted-foreground">{t('table.status')}</TableHead>
                  <TableHead className="text-muted-foreground">{t('table.sent')}</TableHead>
                  <TableHead className="text-muted-foreground">{t('table.error')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecipients.map((recipient) => {
                  const rStatus = getRecipientStatus(recipient.status);
                  return (
                    <TableRow key={recipient.id} className="border-border">
                      <TableCell className="font-medium text-foreground">
                        {recipient.contact?.name ?? 'Unknown'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {recipient.contact?.phone ?? '-'}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${rStatus.classes}`}
                        >
                          {tStatus(rStatus.label)}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {recipient.sentAt ? new Date(recipient.sentAt).toLocaleString() : '-'}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-xs text-red-400">
                        {recipient.errorMessage ?? '-'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
