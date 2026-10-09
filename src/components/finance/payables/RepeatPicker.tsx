"use client";
import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { btnPrimary, btnSecondary, inputCls } from "@/components/ui/Field";
import { segActive, segIdle } from "@/components/finance/finance-ui";
import { NTH_WORDS, WEEKDAY_SHORT, defaultRule, describeRule, ordinal } from "@/server/finance/repeat";
import type { RepeatRule } from "@/server/finance/schemas";

/**
 * Repeat picker (prototype `recurPicker`): live summary, quick picks, then Daily / Weekdays / Weekly / Monthly / Yearly
 * with the interval stepper, weekday pills, "On a date" (incl. last day) or "On a weekday" (first … last), and the
 * end (never / after N times / until a date).
 */
const label = "mb-1.5 mt-3 text-[11px] font-bold uppercase tracking-wide text-gray-500";
const seg = (on: boolean) => `rounded-full px-3 py-1 text-xs font-medium ${on ? segActive : segIdle}`;
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
        <div className="glass rounded-2xl px-3 py-2 text-sm font-semibold">⟳ {describeRule(r)}</div>
        <div className={label}>Quick pick</div>
        <div className="flex flex-wrap gap-1.5">
          {presets.map(([l, o]) => (
            <button key={l} type="button" className={seg(describeRule({ ...r, ...o }) === describeRule(r))} onClick={() => up(o)}>{l}</button>
          ))}
        </div>
        <div className={label}>Or set it yourself</div>
        <div className="flex flex-wrap gap-1.5">
          {(["DAILY", "WEEKDAYS", "WEEKLY", "MONTHLY", "YEARLY"] as const).map((k) => (
            <button key={k} type="button" className={seg(r.freq === k)} onClick={() => up({ freq: k, weekdays: k === "WEEKLY" && !r.weekdays.length ? [wd] : r.weekdays })}>
              {k === "WEEKDAYS" ? "Weekdays" : k.charAt(0) + k.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        {unit ? (
          <div className="mt-2 flex w-max items-center gap-2 rounded-full bg-white/60 px-1 py-0.5">
            <button type="button" className="h-7 w-7 rounded-full text-lg" aria-label="Less often" onClick={() => up({ interval: Math.max(1, r.interval - 1) })}>−</button>
            <b className="min-w-[110px] text-center text-sm">every {r.interval === 1 ? unit : `${r.interval} ${unit}s`}</b>
            <button type="button" className="h-7 w-7 rounded-full text-lg" aria-label="More apart" onClick={() => up({ interval: Math.min(12, r.interval + 1) })}>+</button>
          </div>
        ) : null}
        {r.freq === "WEEKLY" ? (
          <div className="mt-3 flex gap-1">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => {
              const on = r.weekdays.includes(d);
              return (
                <button key={d} type="button" className={`h-8 w-9 rounded-full text-xs font-medium ${on ? segActive : segIdle}`} onClick={() => up({ weekdays: on && r.weekdays.length > 1 ? r.weekdays.filter((x) => x !== d) : Array.from(new Set([...r.weekdays, d])) })}>
                  {WEEKDAY_SHORT[d].slice(0, 2)}
                </button>
              );
            })}
          </div>
        ) : null}
        {r.freq === "MONTHLY" ? (
          <div className="mt-3 space-y-2">
            <div className="flex gap-1.5">
              <button type="button" className={seg(r.monthMode === "DATE")} onClick={() => up({ monthMode: "DATE" })}>On a date</button>
              <button type="button" className={seg(r.monthMode === "NTH")} onClick={() => up({ monthMode: "NTH" })}>On a weekday</button>
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
        <div className={label}>Ends</div>
        <div className="flex gap-1.5">
          {([["NEVER", "Never ends"], ["COUNT", "After…"], ["UNTIL", "Until a date"]] as const).map(([k, l]) => (
            <button key={k} type="button" className={seg(r.endsType === k)} onClick={() => up({ endsType: k, endsCount: r.endsCount ?? 10 })}>{l}</button>
          ))}
        </div>
        {r.endsType === "COUNT" ? (
          <div className="mt-2 flex w-max items-center gap-2 rounded-full bg-white/60 px-1 py-0.5">
            <button type="button" className="h-7 w-7 rounded-full text-lg" aria-label="Fewer" onClick={() => up({ endsCount: Math.max(2, (r.endsCount ?? 10) - 1) })}>−</button>
            <b className="min-w-[80px] text-center text-sm">{r.endsCount ?? 10} times</b>
            <button type="button" className="h-7 w-7 rounded-full text-lg" aria-label="More" onClick={() => up({ endsCount: Math.min(365, (r.endsCount ?? 10) + 1) })}>+</button>
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
