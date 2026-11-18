/**
 * What the screens show for going home early (ADR 0022): the banners (Admin dashboard, Attendance), the morning
 * "Is <Name> back today?" cards (Requests, Attendance) and each person's state today (Attendance, HR view).
 */
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { dateKey } from "@/lib/time";
import { first } from "@/lib/notification-text";
import { toDbDate } from "@/server/inventory/compute";
import { askOpen, awayLabel, covers, keyText, leftAtText, periodDetail, REASON_LABEL, type EarlyRecord } from "@/server/early-leave/core";
import { flaggedTasks, toRecord } from "@/server/early-leave/service";

export type EarlyBanner = {
  id: string;
  userId: string;
  name: string;
  firstName: string;
  /** "2:15pm · Sick · away until 11 Nov" / "… · asking again tomorrow morning". */
  detail: string;
  /** Flagged task ids ("Needs shifting"); the banner shows only when there are some. */
  taskIds: string[];
};

export type BackQuestion = { id: string; userId: string; name: string; text: string };

/** Today's state for a person: the label and the record to cancel (only while it covers today). */
export type EarlyToday = { id: string; label: string; flagged: number };

/** Active early leaves that still matter: covering today or later, or an "Ask tomorrow" not yet answered "Back". */
export async function liveEarlyLeaves(now = new Date()): Promise<{ rec: EarlyRecord; name: string }[]> {
  const tz = (await getSettings()).timezone;
  const today = dateKey(now, tz);
  const rows = await prisma.earlyLeave.findMany({
    where: { active: true, OR: [{ coveredThrough: { gte: toDbDate(today) } }, { mode: "ASK", backOn: null }] },
    include: { user: { select: { name: true } } },
    orderBy: { leftAt: "asc" },
  });
  return rows.map((r) => ({ rec: toRecord(r), name: r.user.name }));
}

export async function earlyBanners(now = new Date()): Promise<EarlyBanner[]> {
  const tz = (await getSettings()).timezone;
  const live = await liveEarlyLeaves(now);
  const out: EarlyBanner[] = [];
  for (const { rec, name } of live) {
    const tasks = await flaggedTasks(rec, tz);
    out.push({ id: rec.id, userId: rec.userId, name, firstName: first(name), detail: periodDetail(rec, tz), taskIds: tasks.map((t) => t.id) });
  }
  return out;
}

/** The morning questions waiting for an answer. */
export async function backQuestions(now = new Date()): Promise<BackQuestion[]> {
  const tz = (await getSettings()).timezone;
  const live = await liveEarlyLeaves(now);
  return live
    .filter(({ rec }) => askOpen(rec) && rec.askDay)
    .map(({ rec, name }) => {
      const extra = Math.round((Date.parse(`${rec.coveredThrough}T00:00:00Z`) - Date.parse(`${rec.day}T00:00:00Z`)) / 86_400_000);
      const more = extra > 0 ? ` · still off ${extra} more day${extra === 1 ? "" : "s"}` : "";
      return { id: rec.id, userId: rec.userId, name, text: `Left early ${keyText(rec.day)} ${leftAtText(rec.leftAt, tz)} · ${REASON_LABEL[rec.reason]}${more}` };
    });
}

/** userId → today's early-leave state (Attendance and the HR view: label + "Cancel early leave"). */
export async function earlyToday(userIds: string[], now = new Date()): Promise<Record<string, EarlyToday>> {
  const tz = (await getSettings()).timezone;
  const today = dateKey(now, tz);
  const live = await liveEarlyLeaves(now);
  const out: Record<string, EarlyToday> = {};
  for (const { rec } of live) {
    if (!userIds.includes(rec.userId) || !covers(rec, today)) continue;
    out[rec.userId] = { id: rec.id, label: awayLabel(rec, today, tz), flagged: (await flaggedTasks(rec, tz)).length };
  }
  return out;
}
