/**
 * Pure helpers for the time pill's "actual time" popover (ADR 0015): tap the scheduled window on a card to see when the
 * task really started and finished. Unit-tested in tests/ui/actual-time.test.ts.
 */
import type { TaskStatus } from "@prisma/client";
import { fmtTime } from "@/lib/time";

export type ActualTimeInput = {
  status: TaskStatus;
  type?: "WORK" | "MEETING";
  scheduledStart: string | Date | null;
  scheduledEnd: string | Date | null;
  actualStart: string | Date | null;
  actualEnd: string | Date | null;
  /** When the assignee marked it done from their side — the finish time while it waits for approval. */
  finishRequestedAt?: string | Date | null;
};

/** One popover row: "Started · 11:20am · 20 min late" (`tone` colours the note: late → red, ok → green). */
export type ActualTimeLine = { label: string; value: string; note: string | null; tone: "late" | "ok" | null };

const toDate = (d: string | Date | null | undefined) => (d ? new Date(d) : null);
/** Whole-minute difference a − b, at the same minute precision as `actualTone`. */
const minutesBetween = (a: Date, b: Date) => Math.floor(a.getTime() / 60000) - Math.floor(b.getTime() / 60000);

/** 20 → "20 min", 95 → "1h 35m", 120 → "2h", 3090 → "2d 3h" (whole days and hours past a day). */
function duration(m: number): string {
  if (m < 60) return `${m} min`;
  if (m < 1440) return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m / 60}h`;
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return h ? `${d}d ${h}h` : `${d}d`;
}

/** "on time" / "20 min late" / "5 min early" / "1h 35m late" / "2d 3h early" (a 0-minute difference is on time). */
export function relativeMinutes(diff: number): string {
  if (diff === 0) return "on time";
  return `${duration(Math.abs(diff))} ${diff > 0 ? "late" : "early"}`;
}

function compare(actual: Date, scheduled: Date | null): Pick<ActualTimeLine, "note" | "tone"> {
  if (!scheduled) return { note: null, tone: null };
  const diff = minutesBetween(actual, scheduled);
  return { note: relativeMinutes(diff), tone: diff > 0 ? "late" : "ok" };
}

/** When the task finished, if it has: the finish request while it waits for approval, else the recorded end. */
function finishedAt(t: ActualTimeInput): Date | null {
  if (t.status === "FINISH_REQUESTED") return toDate(t.finishRequestedAt ?? t.actualEnd);
  if (t.status === "COMPLETED") return toDate(t.actualEnd ?? t.finishRequestedAt);
  return null;
}

/**
 * The popover's rows, times in the company time zone:
 * - Scheduled "11:00am – 3:00pm";
 * - Started "11:20am" + "20 min late" / "5 min early" / "on time" — or "not yet" (+ red "start time passed" once the
 *   scheduled start is behind us; meetings are never started, so they get no red note);
 * - Finished "2:45pm" ("Done (their side)" while finish-requested) + late / early — or, once started, "still running"
 *   ("paused" while paused) + red "past end time" when the scheduled end has gone by. No finish row before the start.
 */
export function actualTimeLines(t: ActualTimeInput, tz: string, now: Date = new Date()): ActualTimeLine[] {
  const start = toDate(t.scheduledStart);
  const end = toDate(t.scheduledEnd);
  const actualStart = toDate(t.actualStart);
  const done = finishedAt(t);
  const lines: ActualTimeLine[] = [{ label: "Scheduled", value: `${fmtTime(start, tz)} – ${fmtTime(end, tz)}`, note: null, tone: null }];

  if (actualStart) lines.push({ label: "Started", value: fmtTime(actualStart, tz), ...compare(actualStart, start) });
  else if (done) lines.push({ label: "Started", value: "not recorded", note: null, tone: null });
  else {
    const missed = t.type !== "MEETING" && !!start && start.getTime() < now.getTime();
    lines.push({ label: "Started", value: "not yet", note: missed ? "start time passed" : null, tone: missed ? "late" : null });
  }

  const label = t.status === "FINISH_REQUESTED" ? "Done (their side)" : "Finished";
  if (done) lines.push({ label, value: fmtTime(done, tz), ...compare(done, end) });
  else if (actualStart) {
    const over = !!end && minutesBetween(now, end) > 0;
    lines.push({ label, value: t.status === "PAUSED" ? "paused" : "still running", note: over ? "past end time" : null, tone: over ? "late" : null });
  }
  return lines;
}
