"use client";
import { useRouter } from "next/navigation";
import { useFromAdd } from "@/components/dashboard/useFromAdd";
import { useCornerClose } from "@/components/shell/corner-store";

/**
 * A form page the bottom row's corner × closes (ADR 0016 addendum, prototype `pageX`) — e.g. the new expense editor:
 * back to the dashboard when the "+" opened it (`from=add`), otherwise Back (or `fallback` when there is no history).
 */
export function useClosablePage(fallback: string, active = true): void {
  const router = useRouter();
  const back = useFromAdd();
  useCornerClose(() => back.done(() => (window.history.length > 1 ? router.back() : router.push(fallback))), active);
}
