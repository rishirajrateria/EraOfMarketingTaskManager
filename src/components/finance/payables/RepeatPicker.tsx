"use client";
import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { btnPrimary, btnSecondary, inputCls } from "@/components/ui/Field";
import { GroupLabel, SegButton, Stepper } from "@/components/ui/Controls";
import { NTH_WORDS, WEEKDAY_SHORT, defaultRule, describeRule, ordinal } from "@/server/finance/repeat";
import type { RepeatRule } from "@/server/finance/schemas";

/**
 * Repeat picker (prototype `recurPicker`): live summary, quick picks, then Daily / Weekdays / Weekly / Monthly / Yearly
 * with the interval stepper, weekday pills, "On a date" (incl. last day) or "On a weekday" (first … last), and the
 * end (never / after N times / until a date).
 */
const UNIT: Record<RepeatRule["freq"], string> = { DAILY: "day", WEEKDAYS: "", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" };

export function RepeatPicker({ init, baseKey, title, onDone, onClose }: { init: RepeatRule | null; baseKey: string; title?: string; onDone: (r: RepeatRule) => void; onClose: () => void }) {
  const base = defaultRule(baseKey);
  const [r, setR] = useState<RepeatRule>(() => (init ? { ...base, ...init } : base));
  const up = (p: Partial<RepeatRule>) => setR((x) => ({ ...x, ...p }));
  const wd = base.weekdays[0];
  const md = base.monthDay;
  const presets: [string, Partial<RepeatRule>][] = [
    ["Every day", { freq: "DAILY", interval: 1 }],
    ["Every weekday", { freq: "WEEKDAYS", interval: 1 }],
    [`Every ${WEEKDAY_SHORT[wd]}`, { freq: "WEEKLY", interval: 1, weekdays: [wd] }],
    ["Every 2 weeks", { freq: "WEEKLY", interval: 2, weekdays: [wd] }],
    [`Every month on the ${ordinal(md)}`, { freq: "MONTHLY", interval: 1, monthMode: "DATE", monthDay: md }],
    ["Every month, last day", { freq: "MONTHLY", interval: 1, monthMode: "DATE", monthDay: 32 }],
    ["Every 3 months", { freq: "MONTHLY", interval: 3, monthMode: "DATE", monthDay: md }],
    ["Every year", { freq: "YEARLY", interval: 1 }],
  ];
  const unit = UNIT[r.freq];
  return (
    <Sheet open onClose={onClose} title={title ?? "Repeat"}>
      <div className="px-4 py-3">
        <div className="glass-card px-3 py-2 text-sm font-semibold">⟳ {describeRule(r)}</div>
        <GroupLabel className="mt-3">Quick pick</GroupLabel>
        <div className="flex flex-wrap gap-1.5">
          {presets.map(([l, o]) => (
            <SegButton key={l} on={describeRule({ ...r, ...o }) === describeRule(r)} onClick={() => up(o)}>{l}</SegButton>
          ))}
        </div>
        <GroupLabel className="mt-3">Or set it yourself</GroupLabel>
        <div className="flex flex-wrap gap-1.5">
          {(["DAILY", "WEEKDAYS", "WEEKLY", "MONTHLY", "YEARLY"] as const).map((k) => (
            <SegButton key={k} on={r.freq === k} onClick={() => up({ freq: k, weekdays: k === "WEEKLY" && !r.weekdays.length ? [wd] : r.weekdays })}>
              {k === "WEEKDAYS" ? "Weekdays" : k.charAt(0) + k.slice(1).toLowerCase()}
            </SegButton>
          ))}
        </div>
        {unit ? (
          <div className="mt-2">
            <Stepper minusLabel="Less often" plusLabel="More apart" valueClass="min-w-[110px]" onMinus={() => up({ interval: Math.max(1, r.interval - 1) })} onPlus={() => up({ interval: Math.min(12, r.interval + 1) })}>
              every {r.interval === 1 ? unit : `${r.interval} ${unit}s`}
            </Stepper>
          </div>
        ) : null}
        {r.freq === "WEEKLY" ? (
          <div className="mt-3 flex gap-1">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => {
              const on = r.weekdays.includes(d);
              return (
                <SegButton key={d} on={on} className="w-10 px-0" label={WEEKDAY_SHORT[d]} onClick={() => up({ weekdays: on && r.weekdays.length > 1 ? r.weekdays.filter((x) => x !== d) : Array.from(new Set([...r.weekdays, d])) })}>
                  {WEEKDAY_SHORT[d].slice(0, 2)}
                </SegButton>
              );
            })}
          </div>
        ) : null}
        {r.freq === "MONTHLY" ? (
          <div className="mt-3 space-y-2">
            <div className="flex gap-1.5">
              <SegButton on={r.monthMode === "DATE"} onClick={() => up({ monthMode: "DATE" })}>On a date</SegButton>
              <SegButton on={r.monthMode === "NTH"} onClick={() => up({ monthMode: "NTH" })}>On a weekday</SegButton>
            </div>
            {r.monthMode === "DATE" ? (
              <select className={inputCls} value={r.monthDay} onChange={(e) => up({ monthDay: Number(e.target.value) })}>
                {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{ordinal(i + 1)}</option>)}
                <option value={32}>Last day of the month</option>
              </select>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <select className={inputCls} value={r.nth} onChange={(e) => up({ nth: Number(e.target.value) })}>
                  {NTH_WORDS.map((n, i) => <option key={n} value={i + 1}>The {n}</option>)}
                </select>
                <select className={inputCls} value={r.nthWeekday} onChange={(e) => up({ nthWeekday: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => <option key={d} value={d}>{WEEKDAY_SHORT[d]}</option>)}
                </select>
              </div>
            )}
          </div>
        ) : null}
        <GroupLabel className="mt-3">Ends</GroupLabel>
        <div className="flex gap-1.5">
          {([["NEVER", "Never ends"], ["COUNT", "After…"], ["UNTIL", "Until a date"]] as const).map(([k, l]) => (
            <SegButton key={k} on={r.endsType === k} onClick={() => up({ endsType: k, endsCount: r.endsCount ?? 10 })}>{l}</SegButton>
          ))}
        </div>
        {r.endsType === "COUNT" ? (
          <div className="mt-2">
            <Stepper minusLabel="Fewer" plusLabel="More" valueClass="min-w-[80px]" onMinus={() => up({ endsCount: Math.max(2, (r.endsCount ?? 10) - 1) })} onPlus={() => up({ endsCount: Math.min(365, (r.endsCount ?? 10) + 1) })}>
              {r.endsCount ?? 10} times
            </Stepper>
          </div>
        ) : null}
        {r.endsType === "UNTIL" ? <input type="date" className={`${inputCls} mt-2`} value={r.endsUntil ?? ""} onChange={(e) => up({ endsUntil: e.target.value || null })} /> : null}
        <div className="mt-4 flex gap-2">
          <button type="button" className={`${btnSecondary} flex-1`} onClick={onClose}>Cancel</button>
          <button type="button" className={`${btnPrimary} flex-1`} disabled={r.endsType === "UNTIL" && !r.endsUntil} onClick={() => onDone({ ...r, anchorDate: baseKey })}>Done</button>
        </div>
      </div>
    </Sheet>
  );
}
