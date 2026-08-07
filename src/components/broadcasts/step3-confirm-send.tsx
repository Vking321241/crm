'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ArrowLeft, ImageIcon, Loader2, Save, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { AudienceConfig } from './step2-select-audience';

interface Step3Props {
  name: string;
  contentText: string;
  mediaUrl: string;
  audience: AudienceConfig;
  onSend: () => void;
  onSaveDraft: () => void;
  onBack: () => void;
  isSending: boolean;
  isSavingDraft: boolean;
}

export function Step3ConfirmSend({
  name,
  contentText,
  mediaUrl,
  audience,
  onSend,
  onSaveDraft,
  onBack,
  isSending,
  isSavingDraft,
}: Step3Props) {
  const t = useTranslations('Broadcasts.wizard.confirm');
  const [showConfirm, setShowConfirm] = useState(false);
  const [estimatedReach, setEstimatedReach] = useState<number | null>(null);
  const busy = isSending || isSavingDraft;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams({ pageSize: '1' });
      if (audience.type === 'tags') {
        for (const id of audience.tagIds ?? []) params.append('tagId', id);
      }
      const res = await fetch(`/api/contacts?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      if (!cancelled) setEstimatedReach(res.ok ? (data.total ?? 0) : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [audience.type, audience.tagIds]);

  const audienceLabel = audience.type === 'all' ? t('audienceAll') : t('audienceTags');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="space-y-3 rounded-xl border border-border bg-card/50 p-4">
        <p className="text-sm font-medium text-foreground">{t('summary')}</p>
        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">{t('name')}</p>
            <p className="text-foreground">{name}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('audience')}</p>
            <p className="text-foreground">{audienceLabel}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('recipients')}</p>
            <p className="font-medium text-foreground">
              {estimatedReach !== null ? estimatedReach.toLocaleString() : '—'}
            </p>
          </div>
          {mediaUrl && (
            <div>
              <p className="text-xs text-muted-foreground">{t('media')}</p>
              <p className="flex items-center gap-1 text-foreground">
                <ImageIcon className="h-3.5 w-3.5" />
                {t('mediaAttached')}
              </p>
            </div>
          )}
        </div>
        <div>
          <p className="mb-1 text-xs text-muted-foreground">{t('message')}</p>
          <div className="rounded-lg bg-[#0e1a12] p-3">
            <div className="ml-auto max-w-[85%] rounded-lg bg-primary/30 px-3 py-2 shadow-sm">
              <p className="whitespace-pre-wrap text-sm text-primary">{contentText}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          disabled={busy}
          className="border-border text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Button>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={onSaveDraft}
            disabled={busy}
            className="border-border text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            {isSavingDraft ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {t('saveDraft')}
          </Button>

          <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
            <DialogTrigger
              render={
                <Button
                  disabled={busy}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                />
              }
            >
              {isSending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {t('sendNow')}
            </DialogTrigger>
            <DialogContent className="border-border bg-popover sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="text-popover-foreground">{t('confirmTitle')}</DialogTitle>
                <DialogDescription className="text-muted-foreground">
                  {t('confirmDesc', { count: estimatedReach ?? 0 })}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setShowConfirm(false)}
                  className="border-border text-muted-foreground"
                >
                  {t('cancel')}
                </Button>
                <Button
                  onClick={() => {
                    setShowConfirm(false);
                    onSend();
                  }}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <Send className="h-4 w-4" />
                  {t('sendNow')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>
    </div>
  );
}
