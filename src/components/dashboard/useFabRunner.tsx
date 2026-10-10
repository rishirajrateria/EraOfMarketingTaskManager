"use client";
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { FabItem } from "@/components/dashboard/fab-model";

/** Which part of a speed-dial row was tapped: the item itself, or the eye right of its icon (list items). */
export type FabTarget = "open" | "view";

/**
 * What choosing an item of the bottom-nav "+" speed dial does: Task / Meeting call `onAdd` (the add-task sheet), every
 * other item opens its screen — a list item's eye opens its list page with the add form minimised, the item itself
 * with the form expanded (ADR 0016 addendum).
 */
export function useFabRunner(onAdd: (mode: "WORK" | "MEETING") => void) {
  const router = useRouter();
  return useCallback(
    (it: FabItem, target: FabTarget = "open") => {
      if (target === "view" && it.view) return router.push(it.view.href);
      const a = it.action;
      if (a.kind === "add") onAdd(a.mode);
      else router.push(a.href);
    },
    [onAdd, router],
  );
}
