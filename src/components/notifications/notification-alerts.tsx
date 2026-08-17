'use client';

// ============================================================
// NotificationAlerts — headless, app-wide poller that pops a corner
// toast (via sonner) when a new row lands in `notifications` for the
// current user (conversation assignments, @mentions in internal
// notes, …), regardless of which page they're on. Mounted once in
// DashboardShellInner. Same "diff against last poll" approach as
// InternalChatAlerts — no realtime layer to hang this off of.
// ============================================================

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Bell } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';

interface NotificationRow {
  id: string;
  title: string;
  body: string | null;
  conversationId: string | null;
}

const POLL_MS = 15000;

export function NotificationAlerts() {
  const { user, profileLoading } = useAuth();
  const router = useRouter();
  const seenIdsRef = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);

  useEffect(() => {
    if (profileLoading || !user) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch('/api/notifications?unreadOnly=true&limit=10', { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const rows = (data.notifications ?? []) as NotificationRow[];

        for (const n of rows) {
          if (seenIdsRef.current.has(n.id)) continue;
          seenIdsRef.current.add(n.id);

          if (!seededRef.current) continue; // baseline pass — no toasts on load

          toast(n.title, {
            description: n.body ?? undefined,
            icon: <Bell className="size-4" />,
            action: n.conversationId
              ? { label: 'Abrir', onClick: () => router.push(`/inbox?c=${n.conversationId}`) }
              : undefined,
          });
        }

        seededRef.current = true;
      } catch {
        // Silent — best-effort alert, not core functionality.
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [profileLoading, user, router]);

  return null;
}
