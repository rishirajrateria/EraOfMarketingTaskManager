"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/Sheet";
import { SheetButtons } from "@/components/ui/CloseX";
import { useToast } from "@/components/ui/Toast";
import { previewEarlyShift, shiftAllEarlyLeave } from "@/server/early-leave/actions";
import type { EarlyBanner } from "@/server/early-leave/queries";
import type { ShiftPlanItem } from "@/server/early-leave/shift";
import { UNMOVABLE_LABEL } from "@/server/scheduling/unmovable";
import { whenPhrase, plural } from "@/lib/notification-text";
import { warnBtn } from "@/components/early-leave/GoingHomeEarlySheet";

const head = "px-1 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[.08em] text-muted";
const tag = "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold";

/**
 * "Shift all to next free slots" confirm (ADR 0022, prototype `shiftAllSheet`): each flagged task with before → after,
 * the ones never moved automatically under "Move yourself", then "Shift N tasks". Admin only.
 */
export function ShiftAllSheet({ banner, tz, onClose }: { banner: EarlyBanner | null; tz: string; onClose: () => void }) {
  return (
    <Sheet open={!!banner} onClose={onClose} title={banner ? `Shift ${banner.firstName}'s tasks` : undefined}>
      {banner ? <Body key={banner.id} banner={banner} tz={tz} onClose={onClose} /> : null}
    </Sheet>
  );
}

function Body({ banner, tz, onClose }: { banner: EarlyBanner; tz: string; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [plan, setPlan] = useState<ShiftPlanItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    let live = true;
    void previewEarlyShift(banner.id).then((r) => live && (r.ok ? setPlan(r.data) : setError(r.error)));
    return () => {
      live = false;
    };
  }, [banner.id]);

  const now = new Date();
  const when = (d: Date | string | null, deadline: boolean) => (d ? `${deadline ? "Due " : ""}${whenPhrase(new Date(d), now, tz)}` : "No time");
  const auto = plan?.filter((p) => p.to) ?? [];
  const manual = plan?.filter((p) => !p.to) ?? [];
  const row = (p: ShiftPlanItem) => (
    <li key={p.taskId} className="flex items-center gap-2 border-b border-line py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <b className="block truncate text-[13.5px]">{p.title}</b>
        <small className="block text-[12px] text-muted">
          {p.to ? (
            <>
              <s>{when(p.from.start, p.deadlineOnly)}</s> → <b className="text-ink">{when(p.to.start, p.deadlineOnly)}</b>
            </>
          ) : (
            `${when(p.from.start, p.deadlineOnly)} · stays where it is · ${p.why === "no-slot" ? "no free slot" : p.why ? UNMOVABLE_LABEL[p.why] : ""}`
          )}
        </small>
      </div>
      {p.to ? <span className={`${tag} bg-emerald-500/15 text-emerald-700 dark:text-emerald-300`}>Shift</span> : <span className={`${tag} bg-amber-500/15 text-amber-700 dark:text-amber-300`}>Move yourself</span>}
    </li>
  );
  const apply = () =>
    start(async () => {
      const r = await shiftAllEarlyLeave(banner.id);
      if (!r.ok) return void toast(r.error, "err");
      toast(`Shifted ${plural(r.data.shifted, "task")}${r.data.manual.length ? ` · ${r.data.manual.length} to move yourself` : ""}`);
      onClose();
      router.refresh();
    });

  return (
    <div className="px-4 pb-4 pt-1">
      <p className="mb-1 text-[13px] text-muted">Each task goes to the next free slot after the away period. Started, paused and finished-from-their-side tasks, meetings and fixed tasks are never moved automatically: move those yourself.</p>
      {error ? <p className="py-3 text-[13px] text-red-600">{error}</p> : null}
      {!plan && !error ? <p className="py-3 text-[13px] text-muted">Finding free slots…</p> : null}
      {auto.length ? (
        <>
          <div className={head}>Will move · {auto.length}</div>
          <ul>{auto.map(row)}</ul>
        </>
      ) : null}
      {manual.length ? (
        <>
          <div className={head}>Move yourself · {manual.length}</div>
          <ul>{manual.map(row)}</ul>
        </>
      ) : null}
      <SheetButtons className="mt-3">
        <button type="button" className={warnBtn} disabled={pending || !auto.length} onClick={apply}>
          Shift {plural(auto.length, "task")}
        </button>
      </SheetButtons>
    </div>
  );
}
