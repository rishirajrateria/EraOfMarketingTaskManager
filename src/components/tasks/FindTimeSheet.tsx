"use client";
import { useEffect, useMemo, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { clsx } from "@/lib/clsx";
import { fmtTime } from "@/lib/time";
import { Sheet } from "@/components/ui/Sheet";
import { Field, btnPrimary, inputCls } from "@/components/ui/Field";
import { GroupLabel } from "@/components/ui/Controls";
import { meetingBusy, type MeetingBusy } from "@/server/tasks/meeting-actions";
import { FIND_TIME_WINDOW, findTimeWindow, suggestSlots, type Span } from "@/server/tasks/meeting";
import { fmtDuration, slotToLocal } from "@/components/tasks/meeting-helpers";

const HOURS = Array.from({ length: (FIND_TIME_WINDOW.endMin - FIND_TIME_WINDOW.startMin) / 60 + 1 }, (_, i) => FIND_TIME_WINDOW.startMin / 60 + i);
const first = (name: string) => name.split(" ")[0] ?? name;
const hourLabel = (h: number) => `${h % 12 || 12}${h >= 12 ? "p" : "a"}`;

/** One timeline bar: hour grid + blocks positioned over the 08:00–21:00 window. */
function Lane({ window, blocks, tone }: { window: Span; blocks: Span[]; tone: "busy" | "free" }) {
  const width = window.end - window.start;
  const pct = (t: number) => `${(Math.min(Math.max(t - window.start, 0), width) / width) * 100}%`;
  return (
    <div
      className="relative h-6 flex-1 overflow-hidden rounded-md border border-hair bg-chip"
      style={{ backgroundImage: `repeating-linear-gradient(90deg, transparent 0, transparent calc(100% / ${HOURS.length - 1} - 1px), rgba(120,130,150,.25) calc(100% / ${HOURS.length - 1} - 1px), rgba(120,130,150,.25) calc(100% / ${HOURS.length - 1}))` }}
    >
      {blocks.map((b, i) => (
        <span
          key={i}
          className={clsx("absolute inset-y-[3px] rounded-[4px]", tone === "busy" ? "bg-[rgba(100,110,125,.7)]" : "bg-[#16a34a]")}
          style={{ left: pct(b.start), width: `calc(${pct(b.end)} - ${pct(b.start)})` }}
        />
      ))}
    </div>
  );
}

/**
 * Find a time (ADR 0012): each internal guest's busy blocks on the chosen day (08:00–21:00, meeting time zone) and
 * the first three slots of the meeting's duration where everyone is free. Tapping a suggestion sets the start time.
 */
export function FindTimeSheet({
  open,
  onClose,
  userIds,
  initialDay,
  zone,
  durationMinutes,
  onPick,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  userIds: string[];
  initialDay: string;
  zone: string;
  durationMinutes: number;
  onPick: (datetimeLocal: string) => void;
  onError: (m: string) => void;
}) {
  const [day, setDay] = useState(initialDay);
  const [data, setData] = useState<MeetingBusy | null>(null);
  const [loading, setLoading] = useState(false);
  const idsKey = userIds.join(",");

  useEffect(() => {
    if (open) setDay(initialDay);
  }, [open, initialDay]);

  useEffect(() => {
    if (!open || !day) return;
    let cancelled = false;
    setLoading(true);
    meetingBusy({ userIds, day, timeZone: zone })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setData(res.data);
        else {
          setData(null);
          onError(res.error);
        }
      })
      .catch(() => !cancelled && onError("Couldn't load busy times"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, day, zone, idsKey]);

  const window = useMemo(() => {
    const w = findTimeWindow(day || initialDay, zone);
    return { start: w.from.getTime(), end: w.to.getTime() };
  }, [day, initialDay, zone]);
  const lanes = (data?.people ?? []).map((p) => ({ ...p, spans: p.busy.map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) })) }));
  const suggestions = data ? suggestSlots(lanes.flatMap((l) => l.spans), window, durationMinutes, { notBefore: Date.now() }) : [];
  const usedGoogle = lanes.some((l) => l.source === "google");

  return (
    <Sheet open={open} onClose={onClose} title="Find a time">
      <div className="space-y-3 px-4 pb-5 pt-1">
        <Field label="Day" hint={`Busy times between 8 am and 9 pm (${zone.replace(/_/g, " ")}). Outside guests aren't checked.`}>
          <input type="date" className={inputCls} value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
        </Field>

        <section aria-label="Busy times" aria-busy={loading}>
          <div className="mb-1 flex items-center gap-2 pl-[68px]" aria-hidden>
            <div className="relative h-3 flex-1 text-[9.5px] text-muted">
              {HOURS.filter((h, i) => i % 2 === 0).map((h) => (
                <span key={h} className="absolute -translate-x-1/2" style={{ left: `${((h - HOURS[0]!) / (HOURS.length - 1)) * 100}%` }}>
                  {hourLabel(h)}
                </span>
              ))}
            </div>
          </div>
          <ul className="space-y-1.5">
            {lanes.map((l) => (
              <li key={l.id} className="flex items-center gap-2">
                <span className="w-[60px] shrink-0 truncate text-[12px] text-ink" title={l.name}>
                  {first(l.name)}
                </span>
                <Lane window={window} blocks={l.spans} tone="busy" />
              </li>
            ))}
            {data ? (
              <li className="flex items-center gap-2">
                <span className="w-[60px] shrink-0 text-[12px] font-semibold text-[#15803d] dark:text-[#4ade80]">Free</span>
                <Lane window={window} blocks={suggestions} tone="free" />
              </li>
            ) : null}
          </ul>
          {loading && !data ? <p className="mt-2 text-xs text-muted">Loading busy times…</p> : null}
          {data ? <p className="mt-2 text-[11px] text-muted">{usedGoogle ? "From Google Calendar free / busy." : "From the tasks and meetings scheduled in this app."}</p> : null}
        </section>

        <section>
          <GroupLabel>{`First free ${fmtDuration(durationMinutes / 60)} slots`}</GroupLabel>
          {data && !suggestions.length ? <p className="text-xs text-muted">No common free slot of {durationMinutes} min on this day. Try another day.</p> : null}
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s.start}
                type="button"
                onClick={() => {
                  onPick(slotToLocal(s.start, zone));
                  onClose();
                }}
                className="no-select h-[34px] rounded-full border border-transparent bg-primary px-3.5 text-[12.5px] font-semibold text-primary-ink"
              >
                {`${fmtTime(new Date(s.start), zone)}–${fmtTime(new Date(s.end), zone)}`}
              </button>
            ))}
          </div>
          {suggestions.length ? <p className="mt-1.5 text-[11px] text-muted">{`${formatInTimeZone(new Date(window.start), zone, "EEE d MMM")} · tap one to set the start time`}</p> : null}
        </section>

        <button type="button" onClick={onClose} className={clsx(btnPrimary, "w-full")}>
          Done
        </button>
      </div>
    </Sheet>
  );
}
