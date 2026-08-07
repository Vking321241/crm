'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Step1ComposeMessage } from '@/components/broadcasts/step1-compose-message';
import {
  Step2SelectAudience,
  type AudienceConfig,
} from '@/components/broadcasts/step2-select-audience';
import { Step3ConfirmSend } from '@/components/broadcasts/step3-confirm-send';
import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';

const steps = ['message', 'audience', 'confirm'] as const;

export default function NewBroadcastPage() {
  const router = useRouter();
  const t = useTranslations('Broadcasts.new');

  const [currentStep, setCurrentStep] = useState(0);
  const [name, setName] = useState('');
  const [contentText, setContentText] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [audience, setAudience] = useState<AudienceConfig>({ type: 'all' });
  const [isSending, setIsSending] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);

  async function createBroadcast(): Promise<string> {
    const res = await fetch('/api/broadcasts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        contentText: contentText.trim(),
        mediaUrl: mediaUrl.trim() || undefined,
        audienceFilter: audience.type === 'tags' ? { tagIds: audience.tagIds } : {},
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Failed to create broadcast');
    return data.broadcast.id as string;
  }

  async function handleSaveDraft() {
    setIsSavingDraft(true);
    try {
      const id = await createBroadcast();
      toast.success(t('toastDraftSaved'));
      router.push(`/broadcasts/${id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save draft');
    } finally {
      setIsSavingDraft(false);
    }
  }

  async function handleSend() {
    setIsSending(true);
    try {
      const id = await createBroadcast();
      const sendRes = await fetch(`/api/broadcasts/${id}/send`, { method: 'POST' });
      const sendData = await sendRes.json().catch(() => ({}));
      if (!sendRes.ok) throw new Error(sendData.error || 'Failed to start send');
      toast.success(t('toastSendStarted'));
      router.push(`/broadcasts/${id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Broadcast failed');
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="flex items-center justify-between">
        {steps.map((step, index) => {
          const isActive = index === currentStep;
          const isCompleted = index < currentStep;

          return (
            <div key={step} className="flex flex-1 items-center">
              <div className="flex items-center gap-2">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-all ${
                    isCompleted
                      ? 'bg-primary text-primary-foreground'
                      : isActive
                        ? 'border-2 border-primary bg-primary/10 text-primary'
                        : 'border border-border bg-muted text-muted-foreground'
                  }`}
                >
                  {isCompleted ? <Check className="h-4 w-4" /> : index + 1}
                </div>
                <span
                  className={`hidden text-sm font-medium sm:block ${
                    isActive ? 'text-foreground' : isCompleted ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  {t(`steps.${step}`)}
                </span>
              </div>
              {index < steps.length - 1 && (
                <div
                  className={`mx-3 h-px flex-1 ${index < currentStep ? 'bg-primary' : 'bg-muted'}`}
                />
              )}
            </div>
          );
        })}
      </div>

      <div className="relative min-h-[400px]">
        <div
          className="transition-all duration-300 ease-in-out"
          style={{
            opacity: isSending || isSavingDraft ? 0.6 : 1,
            pointerEvents: isSending || isSavingDraft ? 'none' : 'auto',
          }}
        >
          {currentStep === 0 && (
            <Step1ComposeMessage
              name={name}
              onNameChange={setName}
              contentText={contentText}
              onContentTextChange={setContentText}
              mediaUrl={mediaUrl}
              onMediaUrlChange={setMediaUrl}
              onNext={() => setCurrentStep(1)}
              onBack={() => router.push('/broadcasts')}
            />
          )}
          {currentStep === 1 && (
            <Step2SelectAudience
              audience={audience}
              onUpdate={setAudience}
              onNext={() => setCurrentStep(2)}
              onBack={() => setCurrentStep(0)}
            />
          )}
          {currentStep === 2 && (
            <Step3ConfirmSend
              name={name}
              contentText={contentText}
              mediaUrl={mediaUrl}
              audience={audience}
              onSend={handleSend}
              onSaveDraft={handleSaveDraft}
              onBack={() => setCurrentStep(1)}
              isSending={isSending}
              isSavingDraft={isSavingDraft}
            />
          )}
        </div>
      </div>
    </div>
  );
}
