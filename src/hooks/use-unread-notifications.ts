"use client";

import { useEffect, useState } from "react";

const POLL_MS = 15_000;

/**
 * Count of unread notifications for the current user. Used by the
 * sidebar to surface a badge on the Notifications nav entry.
 *
 * Polls `/api/notifications/unread-count` — Supabase Realtime isn't
 * available anymore (no Postgres-native equivalent without building
 * one), so this is the tradeoff documented in the Fatia 3 plan.
 */
export function useUnreadNotifications(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const fetchCount = () => {
      fetch("/api/notifications/unread-count")
        .then((res) => res.json())
        .then((data: { count: number }) => {
          if (!cancelled) setCount(data.count ?? 0);
        })
        .catch(() => {});
    };

    fetchCount();
    const interval = setInterval(fetchCount, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return count;
}
