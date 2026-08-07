"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/hooks/use-auth";
import {
  derivePresence,
  type PresenceRow,
  type PresenceStatus,
  type StoredPresence,
} from "@/lib/presence";

const POLL_MS = 15_000;

type PresenceMap = Map<string, PresenceRow>;

interface UsePresenceResult {
  getPresence: (userId: string) => PresenceStatus;
  getRow: (userId: string) => PresenceRow | undefined;
  now: number;
}

/**
 * Presence for every member of the caller's account, polled from
 * `/api/presence` (replaces the Realtime subscription — see Fatia 3
 * plan). `now` still ticks independently so "offline" derives
 * correctly between polls, same as before.
 */
export function usePresence(enabled = true): UsePresenceResult {
  const { accountId } = useAuth();
  const [rows, setRows] = useState<PresenceMap>(() => new Map());
  const [now, setNow] = useState(() => Date.now());
  const active = enabled && !!accountId;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const fetchPresence = () => {
      fetch("/api/presence")
        .then((res) => res.json())
        .then((data: { presence: { userId: string; status: StoredPresence; lastSeenAt: string }[] }) => {
          if (cancelled) return;
          const next = new Map<string, PresenceRow>();
          for (const r of data.presence ?? []) {
            next.set(r.userId, { status: r.status, last_seen_at: r.lastSeenAt });
          }
          setRows(next);
        })
        .catch(() => {});
    };

    fetchPresence();
    const interval = setInterval(fetchPresence, POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
      clearInterval(tick);
    };
  }, [active]);

  const getRow = useCallback((userId: string): PresenceRow | undefined => rows.get(userId), [rows]);

  const getPresence = useCallback(
    (userId: string): PresenceStatus => {
      const row = rows.get(userId);
      return derivePresence(row?.status, row?.last_seen_at, now);
    },
    [rows, now],
  );

  return { getPresence, getRow, now };
}
