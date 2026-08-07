'use client';

import { useRef, useState } from 'react';
import { uploadAccountMedia } from '@/lib/storage/upload-media';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowRight, ImageIcon, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

interface Step1Props {
  name: string;
  onNameChange: (name: string) => void;
  contentText: string;
  onContentTextChange: (text: string) => void;
  mediaUrl: string;
  onMediaUrlChange: (url: string) => void;
  onNext: () => void;
  onBack: () => void;
}

export function Step1ComposeMessage({
  name,
  onNameChange,
  contentText,
  onContentTextChange,
  mediaUrl,
  onMediaUrlChange,
  onNext,
  onBack,
}: Step1Props) {
  const t = useTranslations('Broadcasts.wizard.message');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setUploading(true);
    try {
      const { publicUrl } = await uploadAccountMedia('media', file);
      onMediaUrlChange(publicUrl);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('errorUpload'));
    } finally {
      setUploading(false);
    }
  }

  const isValid = name.trim().length > 0 && contentText.trim().length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          {t('name')}
        </label>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={t('namePlaceholder')}
          className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          {t('messageLabel')}
        </label>
        <textarea
          value={contentText}
          onChange={(e) => onContentTextChange(e.target.value)}
          placeholder={t('messagePlaceholder')}
          rows={6}
          className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
        />
        <p className="mt-1.5 text-xs text-muted-foreground">{t('personalizeHint')}</p>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          {t('mediaLabel')}
        </label>
        {mediaUrl ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 p-3">
            <ImageIcon className="h-4 w-4 shrink-0 text-primary" />
            <a
              href={mediaUrl}
              target="_blank"
              rel="noreferrer"
              className="flex-1 truncate text-xs text-primary hover:underline"
            >
              {mediaUrl}
            </a>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => onMediaUrlChange('')}
              className="h-7 w-7 border-border"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*,audio/*,application/pdf"
              className="hidden"
              onChange={handleFileSelected}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ImageIcon className="h-4 w-4" />
              )}
              {uploading ? t('uploading') : t('uploadButton')}
            </Button>
            <p className="mt-1.5 text-xs text-muted-foreground">{t('mediaHint')}</p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button variant="outline" onClick={onBack} className="border-border text-muted-foreground">
          {t('cancel')}
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
