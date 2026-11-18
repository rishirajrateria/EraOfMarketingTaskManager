"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveEvents } from "@/components/shell/useLiveEvents";

/**
 * Unread-notification and open-request counts, seeded by the server (ADR 0017). A new notification bumps the bell;
 * `requests.changed` never guesses — it re-reads the true counts from /api/badges (a request can open, resolve or
 * move between people, so "+1" drifts).
 */
export function useLiveBadges(userId: string, unread: number, openRequests: number): { unread: number; requests: number } {
  const [badge, setBadge] = useState(unread);
  const [reqBadge, setReqBadge] = useState(openRequests);
  const latest = useRef(0);
  useEffect(() => setBadge(unread), [unread]);
  useEffect(() => setReqBadge(openRequests), [openRequests]);

  const refresh = useCallback(async () => {
    const ticket = ++latest.current; // only the newest response may land
    try {
      const res = await fetch("/api/badges", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { unread: number; requests: number };
      if (ticket !== latest.current) return;
      setReqBadge(body.requests);
      setBadge(body.unread);
    } catch {
      /* offline: keep what we have */
    }
  }, []);

  useLiveEvents((e) => {
    if (e.type === "notification" && e.userId === userId) setBadge((b) => b + 1);
    if (e.type === "requests.changed") void refresh();
  });
  return { unread: badge, requests: reqBadge };
}
