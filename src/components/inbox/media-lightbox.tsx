'use client';

// ============================================================
// MediaLightbox — in-platform full-size viewer for images, videos
// and PDFs, so an agent never has to leave the app / download a file
// just to look at it (matches WhatsApp's own in-app media viewer).
// Any other format falls back to a plain forced download — see
// DocumentDownloadLink below, used directly by message-bubble.tsx
// for non-previewable attachments.
// ============================================================

import { useState, type ReactNode } from 'react';
import { Download, X } from 'lucide-react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';

interface MediaLightboxProps {
  kind: 'image' | 'video' | 'pdf';
  url: string;
  filename?: string;
  /** The clickable thumbnail/trigger. */
  children: ReactNode;
}

export function MediaLightbox({ kind, url, filename, children }: MediaLightboxProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="block cursor-zoom-in">
        {children}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton={false}
          className="flex h-[90vh] max-h-[90vh] w-[95vw] max-w-5xl flex-col gap-0 bg-black/95 p-0 border-none sm:max-w-5xl"
        >
          <DialogTitle className="sr-only">{filename || 'Visualização de mídia'}</DialogTitle>
          <div className="flex items-center justify-end gap-2 p-2">
            <a
              href={url}
              download={filename || true}
              className="flex size-9 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white"
              title="Baixar"
              onClick={(e) => e.stopPropagation()}
            >
              <Download className="size-4" />
            </a>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex size-9 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white"
              title="Fechar"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center overflow-hidden p-4 pt-0">
            {kind === 'image' && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt={filename || ''} className="max-h-full max-w-full object-contain" />
            )}
            {kind === 'video' && (
              <video src={url} controls autoPlay className="max-h-full max-w-full" />
            )}
            {kind === 'pdf' && (
              <iframe src={url} title={filename || 'PDF'} className="h-full w-full rounded bg-white" />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Any file format WhatsApp can't preview inline (CDR, PSD, AI, …) —
 * forced download via the `download` attribute so clicking never
 * navigates away to a blank tab, regardless of the browser's
 * built-in handling for that mimetype. `filename` (when the sender
 * captioned/named the file) becomes the suggested save name so the
 * extension survives the round trip.
 */
export function DocumentDownloadLink({
  url,
  filename,
  children,
}: {
  url: string;
  filename?: string;
  children: ReactNode;
}) {
  return (
    <a href={url} download={filename || true} className="block">
      {children}
    </a>
  );
}
