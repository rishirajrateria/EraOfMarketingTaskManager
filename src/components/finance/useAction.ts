"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { useToast } from "@/components/ui/Toast";

/**
 * Runs a finance server action inside a transition: toasts `error` on failure, otherwise calls `onOk`
 * (a returned string is toasted) and refreshes the RSC tree.
 */
export function useAction() {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = <T,>(call: () => Promise<ActionResult<T>>, onOk?: (data: T) => string | void, opts: { refresh?: boolean } = {}) =>
    start(async () => {
      const res = await call();
      if (!res.ok) {
        toast(res.error, "err");
        return;
      }
      const msg = onOk?.(res.data);
      if (typeof msg === "string") toast(msg);
      if (opts.refresh !== false) router.refresh();
    });
  return { pending, run, toast, router };
}
