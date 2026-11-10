/**
 * Going home early (ADR 0022), the pure part: the covered period, which tasks it flags "Needs shifting", and the
 * phrases the sheet, banner, attendance and HR rows show. No DB access; client-safe.
 */
import { formatInTimeZone } from "date-fns-tz";
import type { EarlyLeaveMode, EarlyLeaveReason } from "@prisma/client";
import { fmtTime, parseDateKey } from "@/lib/time";
import { addKeyDays } from "@/server/availability/day-status";

export const EARLY_REASONS: EarlyLeaveReason[] = ["SICK", "PERSONAL", "OTHER"];
export const REASON_LABEL: Record<EarlyLeaveReason, string> = { SICK: "Sick", PERSONAL: "Personal", OTHER: "Other" };

/** One early leave with its `@db.Date` columns as yyyy-MM-dd keys (company zone). */
export type EarlyRecord = {
  id: string;
  userId: string;
  day: string;
  leftAt: Date;
  reason: EarlyLeaveReason;
  mode: EarlyLeaveMode;
  until: string | null;
  coveredThrough: string;
  askDay: string | null;
  backOn: string | null;
  active: boolean;
};

export type Period = { from: Date; to: Date };

/** [leftAt, start of the day after the last covered day) in the company zone. */
export function coverPeriod(r: Pick<EarlyRecord, "leftAt" | "coveredThrough">, tz: string): Period {
  return { from: r.leftAt, to: parseDateKey(addKeyDays(r.coveredThrough, 1), tz) };
}

/** "Ask tomorrow" still waiting for a "Back" (a morning question comes, or is waiting). */
export const askOpen = (r: Pick<EarlyRecord, "active" | "mode" | "backOn">) => r.active && r.mode === "ASK" && !r.backOn;

export type FlagTask = { status: string; scheduledStart: Date | string | null; scheduledEnd: Date | string | null };

const asDate = (d: Date | string | null) => (d == null ? null : d instanceof Date ? d : new Date(d));

/**
 * Does the task's scheduled time fall in the covered period (from `leftAt` onward)? Open tasks only (drafts and
 * completed ones never); unscheduled tasks never. A deadline (start = end) counts when its instant is inside.
 */
export function hitsPeriod(t: FlagTask, p: Period): boolean {
  if (t.status === "COMPLETED" || t.status === "DRAFT") return false;
  const start = asDate(t.scheduledStart);
  if (!start) return false;
  const end = asDate(t.scheduledEnd) ?? start;
  if (end.getTime() <= start.getTime()) return start >= p.from && start < p.to;
  return start < p.to && end > p.from;
}

/** Quarter-hour rounding for the "Left at" default. */
export function roundToQuarter(d: Date): Date {
  const q = 15 * 60_000;
  return new Date(Math.round(d.getTime() / q) * q);
}

/** "2:15pm" — the app's time style. */
export const leftAtText = (leftAt: Date, tz: string) => fmtTime(leftAt, tz);

/** "11 Nov" for a yyyy-MM-dd key. */
export const keyText = (key: string) => formatInTimeZone(new Date(`${key}T12:00:00Z`), "UTC", "d MMM");

/** Attendance / HR label of a covered day: "Left early 2:15pm · Sick" on the leaving day, "Away · Sick" after it. */
export function awayLabel(r: Pick<EarlyRecord, "day" | "leftAt" | "reason">, dayKey: string, tz: string): string {
  return dayKey === r.day ? `Left early ${leftAtText(r.leftAt, tz)} · ${REASON_LABEL[r.reason]}` : `Away · ${REASON_LABEL[r.reason]}`;
}

/** The banner's second line: "2:15pm · Sick · away until 11 Nov" / "… · asking again tomorrow morning". */
export function periodDetail(r: Pick<EarlyRecord, "leftAt" | "reason" | "mode" | "until" | "backOn">, tz: string): string {
  const tail = r.mode === "UNTIL" && r.until ? `away until ${keyText(r.until)}` : r.backOn ? `back ${keyText(r.backOn)}` : "asking again tomorrow morning";
  return `${leftAtText(r.leftAt, tz)} · ${REASON_LABEL[r.reason]} · ${tail}`;
}

/** The key covering every day of the record, inclusive: does it cover `dayKey`? */
export const covers = (r: Pick<EarlyRecord, "day" | "coveredThrough">, dayKey: string) => dayKey >= r.day && dayKey <= r.coveredThrough;

/** The same label from a `personDayStatus` day's `away` mark (attendance grid, HR tile, Day view). */
export function dayAwayLabel(away: { leftAt: Date | null; reason: string }, tz: string): string {
  const reason = REASON_LABEL[away.reason as EarlyLeaveReason] ?? away.reason;
  return away.leftAt ? `Left early ${leftAtText(away.leftAt, tz)} · ${reason}` : `Away · ${reason}`;
}
