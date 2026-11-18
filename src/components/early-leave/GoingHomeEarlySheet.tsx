"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatInTimeZone } from "date-fns-tz";
import type { EarlyLeaveMode, EarlyLeaveReason } from "@prisma/client";
import { Sheet } from "@/components/ui/Sheet";
import { Field, inputCls } from "@/components/ui/Field";
import { SheetButtons } from "@/components/ui/CloseX";
import { useToast } from "@/components/ui/Toast";
import { clsx } from "@/lib/clsx";
import { markGoingHomeEarly, previewEarlyLeave } from "@/server/early-leave/actions";
import { EARLY_REASONS, REASON_LABEL, roundToQuarter } from "@/server/early-leave/core";
import { first, needShifting, plural } from "@/lib/notification-text";

export type EarlyPerson = { id: string; name: string };

const seg = "inline-flex h-9 items-center rounded-full border px-3.5 text-[13px] font-semibold";
const segOn = "border-transparent bg-primary text-primary-ink";
const segOff = "border-hair bg-chip text-ink";
const optCard = "block w-full rounded-2xl border px-3.5 py-2.5 text-left";
export const warnBtn =
  "touch-target inline-flex min-h-[46px] items-center justify-center gap-1.5 rounded-[14px] bg-[linear-gradient(150deg,#fb923c,#ea580c)] px-4 text-[15px] font-semibold text-white shadow-[0_8px_20px_-10px_rgba(234,88,12,.7)] disabled:opacity-45";

const addDayKey = (key: string, n: number) => new Date(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10) + n)).toISOString().slice(0, 10);

/**
 * "<Name> is going home early" (ADR 0022, prototype `earlySheet`): Left at (now, rounded to 15 min, company zone),
 * Sick / Personal / Other, "Away until…" a last day or "Ask tomorrow", the live "N tasks of <Name> will be flagged for
 * shifting" (same query as the real flags), then "Mark & find tasks". Admin and HR only.
 */
export function GoingHomeEarlySheet({ person, tz, onClose }: { person: EarlyPerson | null; tz: string; onClose: () => void }) {
  return <Sheet open={!!person} onClose={onClose} title={person ? `${person.name} is going home early` : undefined}>{person ? <Body key={person.id} person={person} tz={tz} onClose={onClose} /> : null}</Sheet>;
}

function Body({ person, tz, onClose }: { person: EarlyPerson; tz: string; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const today = formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
  const [leftAt, setLeftAt] = useState(() => formatInTimeZone(roundToQuarter(new Date()), tz, "HH:mm"));
  const [reason, setReason] = useState<EarlyLeaveReason>("SICK");
  const [mode, setMode] = useState<EarlyLeaveMode>("ASK");
  const [until, setUntil] = useState(() => addDayKey(today, 1));
  const [preview, setPreview] = useState<string>("Finding tasks…");
  const name = first(person.name);
  const input = { userId: person.id, leftAt, reason, mode, until: mode === "UNTIL" ? until : null };
  const badUntil = mode === "UNTIL" && (!until || until < today);

  useEffect(() => {
    if (!leftAt) return setPreview("Set the time they left.");
    if (badUntil) return setPreview("Pick the last day away.");
    let live = true;
    const h = setTimeout(async () => {
      const r = await previewEarlyLeave({ userId: person.id, leftAt, reason, mode, until: mode === "UNTIL" ? until : null });
      if (!live) return;
      if (!r.ok) return setPreview(r.error);
      setPreview(r.data.flagged ? `${plural(r.data.flagged, "task")} of ${name} will be flagged for shifting.` : `No tasks of ${name} fall in this period.`);
    }, 250);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [person.id, leftAt, reason, mode, until, badUntil, name]);

  const submit = () =>
    start(async () => {
      if (!leftAt) return void toast("Set the time they left", "err");
      if (badUntil) return void toast("Pick the last day away", "err");
      const r = await markGoingHomeEarly(input);
      if (!r.ok) return void toast(r.error, "err");
      toast(r.data.flagged ? `Marked · ${needShifting(r.data.flagged)}` : "Marked · nothing to shift");
      onClose();
      router.refresh();
    });

  return (
    <div className="space-y-3.5 px-4 pb-4 pt-1">
      <Field label="Left at">
        <input type="time" step={900} className={inputCls} value={leftAt} onChange={(e) => setLeftAt(e.target.value)} aria-label="Left at" />
      </Field>
      <div>
        <span className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-[.07em] text-muted">Reason</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Reason">
          {EARLY_REASONS.map((r) => (
            <button key={r} type="button" aria-pressed={reason === r} onClick={() => setReason(r)} className={clsx(seg, reason === r ? segOn : segOff)}>
              {REASON_LABEL[r]}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <button type="button" aria-pressed={mode === "UNTIL"} onClick={() => setMode("UNTIL")} className={clsx(optCard, mode === "UNTIL" ? "border-[var(--shift)] bg-[var(--ban-bg)]" : "border-hair bg-glass")}>
          <b className="block text-[14px]">Away until…</b>
          <small className="block text-[12px] text-muted">Covers the rest of today and every day through the last day you pick</small>
        </button>
        {mode === "UNTIL" ? (
          <Field label="Last day away">
            <input type="date" min={today} className={inputCls} value={until} onChange={(e) => setUntil(e.target.value)} aria-label="Last day away" />
          </Field>
        ) : null}
        <button type="button" aria-pressed={mode === "ASK"} onClick={() => setMode("ASK")} className={clsx(optCard, mode === "ASK" ? "border-[var(--shift)] bg-[var(--ban-bg)]" : "border-hair bg-glass")}>
          <b className="block text-[14px]">Ask tomorrow</b>
          <small className="block text-[12px] text-muted">Covers the rest of today only. Tomorrow morning HR and Admin are asked: Back or Still off</small>
        </button>
      </div>
      <p role="status" className="text-[13px] font-semibold text-ink">
        {preview}
      </p>
      <SheetButtons>
        <button type="button" disabled={pending} onClick={submit} className={warnBtn}>
          Mark &amp; find tasks
        </button>
      </SheetButtons>
    </div>
  );
}
