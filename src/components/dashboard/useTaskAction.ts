"use client";
import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { useToast } from "@/components/ui/Toast";

/** Runs a task server action, toasts the outcome and refreshes the RSC tree (pending state via useTransition). */
export function useTaskAction() {
  const toast = useToast();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => startTransition(() => router.refresh()), [router]);

  const run = useCallback(
    async <T,>(action: Promise<ActionResult<T>>, successText: string): Promise<T | null> => {
      setBusy(true);
      try {
        const res = await action;
        if (!res.ok) {
          toast(res.error, "err");
          return null;
        }
        if (successText) toast(successText);
        refresh();
        return res.data;
      } catch (e) {
        toast(e instanceof Error ? e.message : "Something went wrong", "err");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [refresh, toast],
  );

  return { busy: busy || pending, run, refresh, toast };
}
