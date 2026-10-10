"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/Sheet";
import { kitPickerClients } from "@/server/shell/kit-picker";
import { NEW_CLIENT_HREF, kitHint, kitHref, sortKitClients, type KitPickerClient } from "@/components/dashboard/fab-model";

const ROW = "touch-target flex w-full flex-col items-start gap-[3px] rounded-[14px] border border-hair bg-glass px-3.5 py-3 text-left backdrop-blur-[22px]";

/**
 * "+" → Client kit (prototype `kitPicker`): pick the client — clients without a kit first — and land on that client's
 * kit page (Create kit / Repair / share and send, ADR 0014). "+ New client" opens the add-client form instead.
 */
export function KitPickerSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [clients, setClients] = useState<KitPickerClient[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setError(null);
    void kitPickerClients().then((r) => {
      if (!live) return;
      if (r.ok) setClients(sortKitClients(r.data));
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [open]);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  return (
    <Sheet open={open} onClose={onClose} title="New client kit">
      <p className="px-4 pb-2 text-[13px] leading-snug text-muted">Pick the client. The kit makes their Drive folders and a credentials sheet.</p>
      <ul className="flex flex-col gap-2 px-4 pb-4">
        {error ? <li className="py-3 text-[13px] text-red-600 dark:text-red-400">{error}</li> : null}
        {!clients && !error ? <li className="py-3 text-[13px] text-muted">Loading clients…</li> : null}
        {clients?.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => go(kitHref(c.id))} className={ROW}>
              <span className="max-w-full truncate text-[15px] font-semibold text-ink">{c.name}</span>
              <span className={c.ready ? "text-xs text-muted" : "text-xs font-semibold text-[#2563eb] dark:text-[#93c5fd]"}>{kitHint(c)}</span>
            </button>
          </li>
        ))}
        <li>
          <button type="button" onClick={() => go(NEW_CLIENT_HREF)} className={ROW}>
            <span className="text-[15px] font-semibold text-ink">+ New client</span>
            <span className="text-xs text-muted">Add the client first, then make the kit</span>
          </button>
        </li>
      </ul>
    </Sheet>
  );
}
