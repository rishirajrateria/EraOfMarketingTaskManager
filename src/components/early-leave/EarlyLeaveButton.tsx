"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { cancelGoingHomeEarly } from "@/server/early-leave/actions";
import { GoingHomeEarlySheet, type EarlyPerson } from "@/components/early-leave/GoingHomeEarlySheet";

const pill = "inline-flex h-8 shrink-0 items-center rounded-full border border-hair bg-chip px-3 text-[12px] font-semibold text-ink disabled:opacity-45";

/**
 * "Going home early" (opens the sheet) or, while an early leave covers today, "Cancel early leave" (ADR 0022). Admin
 * and HR only: the caller renders it only for them, the actions check again.
 */
export function EarlyLeaveButton({ person, earlyId, tz }: { person: EarlyPerson; earlyId: string | null; tz: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  if (earlyId) {
    return (
      <button
        type="button"
        disabled={pending}
        className={pill}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          start(async () => {
            const r = await cancelGoingHomeEarly(earlyId);
            if (!r.ok) return void toast(r.error, "err");
            toast("Early leave cancelled");
            router.refresh();
          });
        }}
      >
        Cancel early leave
      </button>
    );
  }
  return (
    <>
      <button
        type="button"
        className={pill}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        Going home early
      </button>
      <GoingHomeEarlySheet person={open ? person : null} tz={tz} onClose={() => setOpen(false)} />
    </>
  );
}
