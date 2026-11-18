/**
 * Short notification phrases (ADR 0017). When a notification is about a task the feed shows the task title on its
 * own line, so these never repeat it: "Arjun started it 5 min late", "Not started · was due at 10:00am".
 */
import { formatInTimeZone } from "date-fns-tz";
import { dateKey, fmtTime } from "@/lib/time";

export const first = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || "Someone";

/** Whole minutes `b` is after `a` (negative = before), at minute precision like the card's actual pill. */
export function minutesAfter(a: Date, b: Date): number {
  return Math.floor(b.getTime() / 60000) - Math.floor(a.getTime() / 60000);
}

/** 5 → "5 min", 80 → "1 h 20 min", 120 → "2 h". */
export function fmtSpan(min: number): string {
  const m = Math.abs(Math.round(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** Started on time vs late (minutes after the scheduled start; none scheduled = on time). */
export function startPhrase(actor: string | null | undefined, scheduledStart: Date | null, actualStart: Date): { late: boolean; text: string } {
  const late = scheduledStart ? minutesAfter(scheduledStart, actualStart) : 0;
  return late > 0 ? { late: true, text: `${first(actor)} started it ${fmtSpan(late)} late` } : { late: false, text: `${first(actor)} started it on time` };
}

/** "10:00am" today, else "9 Oct, 10:00am". */
export function whenPhrase(d: Date, now: Date, tz: string): string {
  return dateKey(d, tz) === dateKey(now, tz) ? fmtTime(d, tz) : `${formatInTimeZone(d, tz, "d MMM")}, ${fmtTime(d, tz)}`;
}

/** "3:15pm today", else "9 Oct, 3:15pm" — for "expires at …". */
export function whenTodayPhrase(d: Date, now: Date, tz: string): string {
  return dateKey(d, tz) === dateKey(now, tz) ? `${fmtTime(d, tz)} today` : whenPhrase(d, now, tz);
}

export const notStartedPhrase = (scheduledStart: Date, now: Date, tz: string) => `Not started · was due at ${whenPhrase(scheduledStart, now, tz)}`;
export const pastEndPhrase = (scheduledEnd: Date, now: Date, tz: string) => `Still not finished · was due to end at ${whenPhrase(scheduledEnd, now, tz)}`;

/** "Completed · 12 min early" / "Completed · 5 min late" / "Completed on time" / "Completed" (no scheduled end). */
export function completedPhrase(scheduledEnd: Date | null, finishedAt: Date): string {
  if (!scheduledEnd) return "Completed";
  const d = minutesAfter(scheduledEnd, finishedAt);
  if (d === 0) return "Completed on time";
  return `Completed · ${fmtSpan(d)} ${d < 0 ? "early" : "late"}`;
}

/** Leave days: "17 Oct", "17–18 Oct", "30 Oct – 2 Nov" (date keys yyyy-MM-dd). */
export function leaveDays(fromKey: string, toKey: string): string {
  const d = (k: string) => new Date(`${k}T00:00:00Z`);
  const f = d(fromKey);
  const t = d(toKey);
  const fmt = (x: Date, p: string) => formatInTimeZone(x, "UTC", p);
  if (fromKey === toKey) return fmt(f, "d MMM");
  if (fromKey.slice(0, 7) === toKey.slice(0, 7)) return `${fmt(f, "d")}–${fmt(t, "d MMM")}`;
  return `${fmt(f, "d MMM")} – ${fmt(t, "d MMM")}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "3 tasks need shifting" / "1 task needs shifting" / "no tasks to shift" (ADR 0022). */
export const needShifting = (n: number) => (n ? `${plural(n, "task")} need${n === 1 ? "s" : ""} shifting` : "no tasks to shift");

/** "Arush left early · 3 tasks need shifting" — the EARLY_LEAVE feed row and the dashboard banner (ADR 0022). */
export const earlyLeftPhrase = (name: string | null | undefined, flagged: number) => `${first(name)} left early · ${needShifting(flagged)}`;

/** "Arush still off · 2 tasks need shifting" — after "Still off" on the morning question. */
export const stillOffPhrase = (name: string | null | undefined, flagged: number) => `${first(name)} still off · ${needShifting(flagged)}`;

/** The morning question (BACK_QUESTION). */
export const backQuestionPhrase = (name: string | null | undefined) => `Is ${first(name)} back today?`;
/** ADR 0021 — proposals and reassignment (the feed shows the task title on its own line). */
export const proposedPhrase = (tl: string | null | undefined) => `New proposal from ${first(tl)}`;
export const proposalApprovedPhrase = (when: string) => `Approved · ${when} · you can now assign an executive`;
export const proposalRejectedPhrase = (note: string) => `Rejected: ${note}`;
export const proposalWithdrawnPhrase = (tl: string | null | undefined) => `${first(tl)} withdrew the proposal`;
export const movedToPhrase = (names: string) => `Task moved to ${names}`;
export const movedToYouPhrase = (actor: string | null | undefined) => `Task moved to you · by ${first(actor)}`;
