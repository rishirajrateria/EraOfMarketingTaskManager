"use client";
import { useEffect, useState } from "react";
import { clsx } from "@/lib/clsx";
import { Sheet } from "@/components/ui/Sheet";
import { SheetButtons } from "@/components/ui/CloseX";
import { Field, btnPrimary, btnSecondary, inputCls } from "@/components/ui/Field";
import { GroupLabel, SegButton, Stepper } from "@/components/ui/Controls";
import { NTH, WD, defaultRule, describeRule, ordinal, presetActive, repeatPresets, type RepeatFreq, type RepeatRule } from "@/server/tasks/repeat-rule";

const FREQS: [RepeatFreq, string][] = [
  ["DAILY", "Daily"],
  ["WEEKDAYS", "Weekdays"],
  ["WEEKLY", "Weekly"],
  ["MONTHLY", "Monthly"],
  ["YEARLY", "Yearly"],
];
const UNIT: Record<RepeatFreq, string> = { DAILY: "day", WEEKDAYS: "", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" };
const MON_FIRST = [1, 2, 3, 4, 5, 6, 0];

type Props = {
  open: boolean;
  onClose: () => void;
  /** current rule (null = not repeating yet) */
  value: RepeatRule | null;
  /** yyyy-MM-dd the presets are based on: the picked start day, else today (company tz) */
  base: string;
  onDone: (rule: RepeatRule) => void;
  /** "Don't repeat" — only offered when the task already repeats */
  onClear?: () => void;
  title?: string;
};

/**
 * "Repeat this task" (prototype `recurPicker`): live summary, Quick pick presets, "Or set it yourself"
 * (Daily / Weekdays / Weekly + Mo–Su / Monthly on a date or the nth weekday / Yearly, every N), and Ends.
 */
export function RepeatSheet({ open, onClose, value, base, onDone, onClear, title = "Repeat this task" }: Props) {
  const [r, setR] = useState<RepeatRule>(() => value ?? defaultRule(base));
  useEffect(() => {
    if (open) setR(value ? { ...value, days: [...value.days] } : defaultRule(base));
  }, [open, value, base]);
  const set = (p: Partial<RepeatRule>) => setR((x) => ({ ...x, ...p }));
  const wd = defaultRule(base).nthDay;
  const unit = UNIT[r.freq];
  const every = (n: number) => `every ${n === 1 ? unit : `${n} ${unit}s`}`;

  const toggleDay = (d: number) => set({ days: r.days.includes(d) ? (r.days.length > 1 ? r.days.filter((x) => x !== d) : r.days) : [...new Set([...r.days, d])] });

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="px-4 pb-5 pt-1 text-ink">
        <div className="recsum mb-3 mt-1" aria-live="polite">
          ⟳ {describeRule(r)}
        </div>

        <GroupLabel>Quick pick</GroupLabel>
        <div className="mb-3 flex flex-wrap gap-2">
          {repeatPresets(base).map((p) => (
            <SegButton key={p.label} on={presetActive(r, p.patch)} onClick={() => set(p.patch)}>
              {p.label}
            </SegButton>
          ))}
        </div>

        <GroupLabel className="mt-1">Or set it yourself</GroupLabel>
        <div className="flex flex-wrap gap-2">
          {FREQS.map(([k, label]) => (
            <SegButton key={k} on={r.freq === k} onClick={() => set({ freq: k, days: k === "WEEKLY" && !r.days.length ? [wd] : r.days })}>
              {label}
            </SegButton>
          ))}
        </div>
        {unit ? (
          <div className="mt-2">
            <Stepper onMinus={() => set({ interval: Math.max(1, r.interval - 1) })} onPlus={() => set({ interval: Math.min(12, r.interval + 1) })} valueClass="min-w-[110px]">
              {every(r.interval)}
            </Stepper>
          </div>
        ) : null}

        {r.freq === "WEEKLY" ? (
          <div className="mt-3">
            <Field label="On">
              <div className="flex gap-1.5" role="group" aria-label="Weekdays">
                {MON_FIRST.map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={r.days.includes(d)}
                    aria-label={WD[d]}
                    onClick={(e) => {
                      e.preventDefault();
                      toggleDay(d);
                    }}
                    className={clsx("h-9 w-9 rounded-full border text-xs font-semibold", r.days.includes(d) ? "border-transparent bg-primary text-primary-ink" : "border-hair bg-chip text-ink")}
                  >
                    {WD[d].slice(0, 2)}
                  </button>
                ))}
              </div>
            </Field>
          </div>
        ) : null}

        {r.freq === "MONTHLY" ? (
          <div>
            <div className="my-2.5 flex gap-2">
              <SegButton on={r.monthMode === "DATE"} onClick={() => set({ monthMode: "DATE" })}>
                On a date
              </SegButton>
              <SegButton on={r.monthMode === "NTH"} onClick={() => set({ monthMode: "NTH" })}>
                On a weekday
              </SegButton>
            </div>
            {r.monthMode === "DATE" ? (
              <select className={inputCls} aria-label="Day of the month" value={r.monthDay} onChange={(e) => set({ monthDay: Number(e.target.value) })}>
                {Array.from({ length: 31 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {ordinal(i + 1)}
                  </option>
                ))}
                <option value={32}>Last day of the month</option>
              </select>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <select className={inputCls} aria-label="Which week" value={r.nth} onChange={(e) => set({ nth: Number(e.target.value) })}>
                  {NTH.map((n, i) => (
                    <option key={n} value={i + 1}>
                      The {n}
                    </option>
                  ))}
                </select>
                <select className={inputCls} aria-label="Weekday" value={r.nthDay} onChange={(e) => set({ nthDay: Number(e.target.value) })}>
                  {MON_FIRST.map((d) => (
                    <option key={d} value={d}>
                      {WD[d]}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        ) : null}

        <GroupLabel className="mt-3">Ends</GroupLabel>
        <div className="flex flex-wrap gap-2">
          <SegButton on={r.ends === "NEVER"} onClick={() => set({ ends: "NEVER" })}>
            Never ends
          </SegButton>
          <SegButton on={r.ends === "COUNT"} onClick={() => set({ ends: "COUNT" })}>
            After…
          </SegButton>
          <SegButton on={r.ends === "UNTIL"} onClick={() => set({ ends: "UNTIL" })}>
            Until a date
          </SegButton>
        </div>
        {r.ends === "COUNT" ? (
          <div className="mt-2">
            <Stepper onMinus={() => set({ count: Math.max(2, r.count - 1) })} onPlus={() => set({ count: Math.min(365, r.count + 1) })} valueClass="min-w-[80px]">
              {r.count} times
            </Stepper>
          </div>
        ) : null}
        {r.ends === "UNTIL" ? <input type="date" aria-label="Repeat until" className={clsx(inputCls, "mt-2")} value={r.until} min={base} onChange={(e) => set({ until: e.target.value })} /> : null}

        <SheetButtons className="mt-4">
          {onClear ? (
            <button
              type="button"
              className={clsx(btnSecondary, "flex-1 text-[#dc2626]")}
              onClick={() => {
                onClose();
                onClear();
              }}
            >
              Don&apos;t repeat
            </button>
          ) : null}
          <button
            type="button"
            className={btnPrimary}
            disabled={r.ends === "UNTIL" && !r.until}
            onClick={() => {
              onClose();
              onDone({ ...r, anchor: r.anchor ?? base });
            }}
          >
            Done
          </button>
        </SheetButtons>
      </div>
    </Sheet>
  );
}
