"use client";
import { useEffect, useState } from "react";
import { offDayWarnings } from "@/server/availability/actions";

/**
 * "<Name> is off that day" under a manually picked start (ADR 0019). Non-blocking: the form still saves. Checks the
 * assignees against `personDayStatus` on the server (leave, holiday, weekly off, absent), debounced 300ms.
 */
export function useOffDayWarnings(userIds: string[], start: string | null | undefined, enabled = true): string[] {
  const [messages, setMessages] = useState<string[]>([]);
  const ids = userIds.join(",");
  useEffect(() => {
    setMessages([]);
    if (!enabled || !start || !ids) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const r = await offDayWarnings(ids.split(","), start).catch(() => null);
      if (!cancelled && r?.ok) setMessages(r.data.map((w) => w.message));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [ids, start, enabled]);
  return messages;
}

/** The hook and the line together, for forms that cannot call hooks where the start is known (the edit sheet). */
export function OffDayWarningFor({ userIds, start, className }: { userIds: string[]; start: string | null; className?: string }) {
  return <OffDayWarning messages={useOffDayWarnings(userIds, start)} className={className} />;
}

export function OffDayWarning({ messages, className }: { messages: string[]; className?: string }) {
  if (!messages.length) return null;
  return (
    <div role="status" data-off-day-warning className={`rounded-lg bg-amber-100/80 px-3 py-1.5 text-xs font-medium text-amber-800 ${className ?? ""}`}>
      {messages.join(" · ")}
    </div>
  );
}
