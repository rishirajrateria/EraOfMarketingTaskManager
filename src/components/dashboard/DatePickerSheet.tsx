"use client";
import { useEffect, useState } from "react";
import { addDays } from "date-fns";
import { dateKey, zonedStartOfDay } from "@/lib/time";
import { Sheet } from "@/components/ui/Sheet";
import { btnPrimary, btnSecondary, inputCls } from "@/components/ui/Field";

/** Bottom-bar calendar icon → pick a single day (yyyy-MM-dd in company tz) to filter the list. */
export function DatePickerSheet({
  open,
  value,
  tz,
  onChange,
  onClose,
}: {
  open: boolean;
  value: string | null;
  tz: string;
  onChange: (date: string | null) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => {
    if (open) setDraft(value ?? "");
  }, [open, value]);
  const today = dateKey(new Date(), tz);
  const tomorrow = dateKey(addDays(zonedStartOfDay(new Date(), tz), 1), tz);
  const apply = (v: string | null) => {
    onChange(v);
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Filter by date">
      <div className="space-y-3 px-4 pb-6 pt-3">
        <input type="date" value={draft} onChange={(e) => setDraft(e.target.value)} className={inputCls} aria-label="Date" />
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btnSecondary} onClick={() => apply(today)}>
            Today
          </button>
          <button type="button" className={btnSecondary} onClick={() => apply(tomorrow)}>
            Tomorrow
          </button>
          <button type="button" className={btnSecondary} onClick={() => apply(null)}>
            Clear
          </button>
          <button type="button" className={`${btnPrimary} ml-auto`} disabled={!draft} onClick={() => apply(draft || null)}>
            Apply
          </button>
        </div>
      </div>
    </Sheet>
  );
}
