"use client";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { KitPickerSheet } from "@/components/dashboard/KitPickerSheet";
import type { FabItem } from "@/components/dashboard/fab-model";

/**
 * What choosing a "+" item does, shared by the dashboard speed dial and the add-task icon strip: Task / Meeting open
 * the add-task sheet, the Admin shortcuts open their screens, Client kit opens the "New client kit" picker (`sheet`).
 */
export function useFabRunner(onAdd: (mode: "WORK" | "MEETING") => void) {
  const router = useRouter();
  const [kitOpen, setKitOpen] = useState(false);
  const run = useCallback(
    (it: FabItem) => {
      const a = it.action;
      if (a.kind === "add") onAdd(a.mode);
      else if (a.kind === "href") router.push(a.href);
      else setKitOpen(true);
    },
    [onAdd, router],
  );
  return { run, sheet: <KitPickerSheet open={kitOpen} onClose={() => setKitOpen(false)} /> };
}
