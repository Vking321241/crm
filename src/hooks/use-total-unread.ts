"use client";

import { useEffect, useState } from "react";

const POLL_MS = 15_000;

/**
 * Count of conversations with at least one unread inbound message for
 * the current user's account. Used by the sidebar to surface a green
 * dot on the Inbox nav entry. Polls `/api/conversations/unread-count`
 * (Realtime replaced by polling, see Fatia 3 plan).
 */
export function useTotalUnread(): number {
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const fetchTotal = () => {
      fetch("/api/conversations/unread-count")
        .then((res) => res.json())
        .then((data: { count: number }) => {
          if (!cancelled) setTotal(data.count ?? 0);
        })
        .catch(() => {});
    };

    fetchTotal();
    const interval = setInterval(fetchTotal, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return total;
}
