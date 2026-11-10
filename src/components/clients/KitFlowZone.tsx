"use client";
import { KitPickerSheet } from "@/components/dashboard/KitPickerSheet";
import { PeekZone } from "@/components/shell/PeekBar";
import { useAddForm } from "@/components/shell/useAddForm";
import { LIST_FLOWS } from "@/components/shell/list-flow";

/**
 * Bottom zone of the client-kit list. Opened by the "+" speed dial (`?add=1|min&from=add`, ADR 0016 addendum) its add
 * form is the "New client kit" picker — expanded, or minimised to the bar above the bottom nav — and the page's own
 * zone gives way to that bar. Opened any other way the page keeps `zone`.
 */
export function KitFlowZone({ zone }: { zone: React.ReactNode }) {
  const add = useAddForm();
  if (!add.inFlow) return <>{zone}</>;
  return (
    <>
      <PeekZone label={LIST_FLOWS.KIT.peek} onExpand={add.show} />
      <KitPickerSheet open={add.open} onClose={add.cancel} onDismiss={add.dismiss} />
    </>
  );
}
