'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Users, Tags, Loader2, ArrowRight, ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';

export type AudienceType = 'all' | 'tags';

export interface AudienceConfig {
  type: AudienceType;
  tagIds?: string[];
}

interface ApiTag {
  id: string;
  name: string;
  color: string;
}

interface Step2Props {
  audience: AudienceConfig;
  onUpdate: (audience: AudienceConfig) => void;
  onNext: () => void;
  onBack: () => void;
}

export function Step2SelectAudience({ audience, onUpdate, onNext, onBack }: Step2Props) {
  const t = useTranslations('Broadcasts.wizard.audience');
  const [tags, setTags] = useState<ApiTag[]>([]);
  const [loadingTags, setLoadingTags] = useState(true);
  const [estimatedCount, setEstimatedCount] = useState<number | null>(null);
  const [loadingCount, setLoadingCount] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingTags(true);
      try {
        const res = await fetch('/api/tags', { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setTags(res.ok ? (data.tags ?? []) : []);
      } finally {
        if (!cancelled) setLoadingTags(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchEstimatedCount = useCallback(async () => {
    if (audience.type === 'tags' && (!audience.tagIds || audience.tagIds.length === 0)) {
      setEstimatedCount(null);
      return;
    }
    setLoadingCount(true);
    try {
      const params = new URLSearchParams({ pageSize: '1' });
      if (audience.type === 'tags') {
        for (const id of audience.tagIds ?? []) params.append('tagId', id);
      }
      const res = await fetch(`/api/contacts?${params.toString()}`, { cache: 'no-store' });
      const data = await res.json().catch(() => ({}));
      setEstimatedCount(res.ok ? (data.total ?? 0) : null);
    } finally {
      setLoadingCount(false);
    }
  }, [audience.type, audience.tagIds]);

  useEffect(() => {
    fetchEstimatedCount();
  }, [fetchEstimatedCount]);

  function toggleTag(tagId: string) {
    const current = audience.tagIds ?? [];
    const updated = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    onUpdate({ ...audience, tagIds: updated });
  }

  const isValid =
    audience.type === 'all' || (audience.type === 'tags' && (audience.tagIds?.length ?? 0) > 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          onClick={() => onUpdate({ type: 'all' })}
          className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${
            audience.type === 'all'
              ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
              : 'border-border bg-card/50 hover:border-border'
          }`}
        >
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              audience.type === 'all'
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            <Users className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{t('all')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('allDesc')}</p>
          </div>
        </button>

        <button
          onClick={() => onUpdate({ type: 'tags', tagIds: audience.tagIds ?? [] })}
          className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${
            audience.type === 'tags'
              ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
              : 'border-border bg-card/50 hover:border-border'
          }`}
        >
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              audience.type === 'tags'
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            <Tags className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{t('tags')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('tagsDesc')}</p>
          </div>
        </button>
      </div>

      {audience.type === 'tags' && (
        <div className="rounded-xl border border-border bg-card/50 p-4">
          <p className="mb-3 text-sm font-medium text-foreground">{t('selectTags')}</p>
          {loadingTags ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : tags.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('noTagsFound')}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => {
                const isSelected = audience.tagIds?.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() => toggleTag(tag.id)}
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                      isSelected
                        ? 'border-primary/30 bg-primary/10 text-primary'
                        : 'border-border bg-muted text-muted-foreground hover:border-border'
                    }`}
                  >
                    <span
                      className="mr-1.5 h-2 w-2 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card/50 p-4">
        <p className="mb-2 text-sm font-medium text-foreground">{t('estimatedRecipients')}</p>
        {loadingCount ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-xs text-muted-foreground">{t('calculating')}</span>
          </div>
        ) : estimatedCount !== null ? (
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <span className="text-sm text-foreground">{estimatedCount.toLocaleString()}</span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{t('selectTagsPrompt')}</p>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button variant="outline" onClick={onBack} className="border-border text-muted-foreground">
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Button>
        <Button
          onClick={onNext}
          disabled={!isValid}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t('next')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
