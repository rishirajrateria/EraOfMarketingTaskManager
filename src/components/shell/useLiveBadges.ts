"use client";
import { useEffect, useState } from "react";
import { useLiveEvents } from "@/components/shell/useLiveEvents";

/** Unread-notification and open-request counts, seeded by the server and bumped by live events (ADR 0017). */
export function useLiveBadges(userId: string, unread: number, openRequests: number): { unread: number; requests: number } {
  const [badge, setBadge] = useState(unread);
  const [reqBadge, setReqBadge] = useState(openRequests);
  useEffect(() => setBadge(unread), [unread]);
  useEffect(() => setReqBadge(openRequests), [openRequests]);
  useLiveEvents((e) => {
    if (e.type === "notification" && e.userId === userId) setBadge((b) => b + 1);
    if (e.type === "requests.changed") setReqBadge((b) => b + 1);
  });
  return { unread: badge, requests: reqBadge };
}
