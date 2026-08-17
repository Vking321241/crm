'use client';

// ============================================================
// InternalChatAlerts — headless, app-wide poller that pops a corner
// toast (via sonner, see ThemedToaster's position="top-right") when
// a new internal-chat message arrives, regardless of which page the
// user is currently on. Mounted once in DashboardShellInner so it
// runs for the whole authenticated app, not just the /internal-chat
// page itself.
//
// Detecting "new" without a realtime layer: each poll compares every
// channel's `last_message_at` against what the previous poll saw.
// The very first poll only seeds the baseline (no toast) so login
// doesn't replay every unread message that already existed.
// ============================================================

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { MessageCircle } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';

interface ChannelSummary {
  id: string;
  display_name: string;
  is_direct: boolean;
  last_message_text?: string;
  last_message_at?: string;
  last_message_sender_id?: string;
  unread_count: number;
}

const POLL_MS = 6000;

export function InternalChatAlerts() {
  const { user, hasPermission, profileLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const seenAtRef = useRef<Map<string, string>>(new Map());
  const seededRef = useRef(false);
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (profileLoading || !user || !hasPermission('internal_chat')) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch('/api/internal-chat/channels', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const channels = (data.channels ?? []) as ChannelSummary[];

        const onInternalChatPage = pathnameRef.current?.startsWith('/internal-chat');

        for (const c of channels) {
          if (!c.last_message_at) continue;
          const prevSeen = seenAtRef.current.get(c.id);
          seenAtRef.current.set(c.id, c.last_message_at);

          if (!seededRef.current) continue; // baseline pass — no toasts
          if (prevSeen === c.last_message_at) continue; // unchanged
          if (c.last_message_sender_id === user.id) continue; // own message
          if (onInternalChatPage) continue; // already looking at it

          toast(c.is_direct ? c.display_name : `# ${c.display_name}`, {
            description: c.last_message_text || 'Nova mensagem',
            icon: <MessageCircle className="size-4" />,
            action: {
              label: 'Abrir',
              onClick: () => router.push('/internal-chat'),
            },
          });
        }

        seededRef.current = true;
      } catch {
        // Silent — this is a best-effort alert, not core functionality.
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [profileLoading, user, hasPermission, router]);

  return null;
}
