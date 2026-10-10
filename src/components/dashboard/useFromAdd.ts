"use client";
import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FROM_ADD_PARAM, FROM_ADD_VALUE } from "@/components/dashboard/fab-model";

/**
 * Screens the dashboard "+" opens on their own page (`?from=add`, ADR 0016 addendum): closing their form with the
 * blue × — or finishing it — returns to the dashboard, as if the form had opened on top of it.
 * `done(fallback)` runs `fallback` when the screen was opened normally.
 */
export function useFromAdd() {
  const router = useRouter();
  const fromAdd = useSearchParams()?.get(FROM_ADD_PARAM) === FROM_ADD_VALUE;
  const done = useCallback(
    (fallback?: () => void) => {
      if (fromAdd) router.replace("/dashboard");
      else fallback?.();
    },
    [fromAdd, router],
  );
  return { fromAdd, done };
}
