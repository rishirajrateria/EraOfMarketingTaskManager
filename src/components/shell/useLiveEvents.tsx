"use client";
import { useEffect, useRef } from "react";
import type { AppEvent } from "@/lib/events";

/** Subscribes to the SSE stream at /api/events for real-time updates (SPEC §14). */
export function useLiveEvents(handler: (e: AppEvent) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (typeof window === "undefined" || !("EventSource" in window)) return;
    const es = new EventSource("/api/events");
    es.onmessage = (msg) => {
      try {
        ref.current(JSON.parse(msg.data) as AppEvent);
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, []);
}
