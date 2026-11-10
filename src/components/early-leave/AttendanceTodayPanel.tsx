"use client";
import { clsx } from "@/lib/clsx";
import type { AttendanceToday } from "@/server/attendance/today";
import { needShifting } from "@/lib/notification-text";
import { BackQuestionCards, EarlyBanners } from "@/components/early-leave/EarlyBanners";
import { EarlyLeaveButton } from "@/components/early-leave/EarlyLeaveButton";

/**
 * Attendance · Today for HR and Admin (ADR 0022, prototype `PAGES.attendance`): the early-leave banners (HR read-only:
 * "Admin will shift these"), the morning "Is <Name> back today?" cards, then each person with today's status and
 * "Going home early" / "Cancel early leave".
 */
export function AttendanceTodayPanel({ today, canShift }: { today: AttendanceToday; canShift: boolean }) {
  return (
    <div data-attendance-today>
      <EarlyBanners banners={today.banners} canShift={canShift} tz={today.tz} />
      <BackQuestionCards questions={today.questions} />
      <section className="glass mx-3 mt-3 rounded-2xl px-3 py-1" aria-label="Today">
        <h2 className="pb-1 pt-2 text-[11px] font-bold uppercase tracking-[.08em] text-muted">Today</h2>
        <ul>
          {today.people.map((p) => (
            <li key={p.id} className="flex items-center gap-2 border-b border-line py-2.5 last:border-b-0">
              <div className="min-w-0 flex-1">
                <b className="block truncate text-[14px]">{p.name}</b>
                <small className="block truncate text-[11.5px] text-muted">{p.sub}</small>
                <small className={clsx("block truncate text-[12px] font-semibold", p.away ? "text-[#c2410c] dark:text-[#fdba74]" : "text-muted")}>{p.status}</small>
                {p.flagged ? <small className="block text-[12px] font-semibold text-[#c2410c] dark:text-[#fdba74]">{needShifting(p.flagged)}</small> : null}
              </div>
              <EarlyLeaveButton person={{ id: p.id, name: p.name }} earlyId={p.earlyId} tz={today.tz} />
            </li>
          ))}
          {today.people.length === 0 ? <li className="py-3 text-[12px] text-muted">No team leaders or executives.</li> : null}
        </ul>
        <p className="pb-2 pt-1 text-[11.5px] text-muted">“Going home early” is only for HR and Admin.</p>
      </section>
    </div>
  );
}
