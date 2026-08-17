"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, Loader2, UserPlus } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// Fatia 3: polling instead of Supabase Realtime (no native equivalent
// in plain Postgres — see the Fatia 3 plan). POLL_MS matches the
// sidebar badge hooks (use-unread-notifications.ts).
const POLL_MS = 15_000;

interface NotificationRow {
  id: string;
  type: "conversation_assigned";
  title: string;
  body: string | null;
  conversationId: string | null;
  readAt: string | null;
  createdAt: string;
}

const TYPE_ICON: Record<NotificationRow["type"], typeof Bell> = {
  conversation_assigned: UserPlus,
};

export default function NotificationsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=100", { cache: "no-store" });
      if (!res.ok) throw new Error("Falha ao carregar notificações");
      const data = (await res.json()) as { notifications: NotificationRow[] };
      setNotifications(data.notifications);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar notificações");
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(interval);
  }, [load]);

  const markRead = useCallback(async (id: string) => {
    setNotifications(
      (prev) =>
        prev?.map((n) => (n.id === id && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)) ??
        prev,
    );
    const res = await fetch(`/api/notifications/${id}/read`, { method: "PATCH" });
    if (!res.ok) toast.error("Falha ao marcar como lida");
  }, []);

  const handleClick = useCallback(
    (n: NotificationRow) => {
      if (!n.readAt) void markRead(n.id);
      if (n.conversationId) {
        router.push(`/inbox?c=${n.conversationId}`);
      }
    },
    [markRead, router],
  );

  const unreadIds = notifications?.filter((n) => !n.readAt).map((n) => n.id) ?? [];

  const markAllRead = useCallback(async () => {
    if (unreadIds.length === 0) return;
    setMarkingAll(true);
    const now = new Date().toISOString();
    setNotifications((prev) => prev?.map((n) => (n.readAt ? n : { ...n, readAt: now })) ?? prev);
    const res = await fetch("/api/notifications/read-all", { method: "POST" });
    setMarkingAll(false);
    if (!res.ok) {
      toast.error("Falha ao marcar todas como lidas");
      void load();
    }
  }, [unreadIds.length, load]);

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (notifications === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Notificações</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Conversas que outros colegas atribuem a você aparecem aqui.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={unreadIds.length === 0 || markingAll}
          onClick={markAllRead}
        >
          {markingAll ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCheck className="h-4 w-4" />
          )}
          Marcar todas como lidas
        </Button>
      </div>

      {notifications.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/40">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Bell className="h-6 w-6 text-primary" />
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">Nenhuma notificação ainda</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Você verá um alerta aqui quando alguém atribuir uma conversa a você.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {notifications.map((n) => {
            const Icon = TYPE_ICON[n.type] ?? Bell;
            const isUnread = !n.readAt;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => handleClick(n)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors",
                    isUnread
                      ? "border-primary/30 bg-primary/5 hover:border-primary/50"
                      : "border-border bg-card hover:border-border/70",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg",
                      isUnread ? "bg-primary/15" : "bg-muted",
                    )}
                    aria-hidden
                  >
                    <Icon className={cn("h-5 w-5", isUnread ? "text-primary" : "text-muted-foreground")} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "truncate text-sm font-semibold",
                          isUnread ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {n.title}
                      </span>
                      {isUnread && (
                        <span aria-label="Unread" className="h-2 w-2 flex-shrink-0 rounded-full bg-primary" />
                      )}
                    </div>
                    {n.body && <p className="mt-0.5 truncate text-xs text-muted-foreground">{n.body}</p>}
                    <p className="mt-1 text-[11px] text-muted-foreground/70">
                      {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
