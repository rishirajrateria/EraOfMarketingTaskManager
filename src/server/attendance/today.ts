/**
 * Attendance · Today (ADR 0022): each Team Leader and Executive with today's status from `personDayStatus` (so "Left
 * early 2:15pm · Sick" / "Away · Sick" read exactly as inventory and the slot finder see the day), plus the early-leave
 * banners and the morning "Is <Name> back today?" cards. HR and Admin only.
 */
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { dateKey } from "@/lib/time";
import { toWorkingConfig } from "@/server/inventory/compute";
import { loadAvailability, loadPeople } from "@/server/availability/load";
import type { DayKind } from "@/server/availability/day-status";
import { dayAwayLabel } from "@/server/early-leave/core";
import { backQuestions, earlyBanners, earlyToday, type BackQuestion, type EarlyBanner } from "@/server/early-leave/queries";

export type TodayPerson = {
  id: string;
  name: string;
  sub: string;
  /** "Present" / "Not marked" / "Left early 2:15pm · Sick" / "Away · Sick" … */
  status: string;
  away: boolean;
  /** The early leave covering today (Cancel), if any. */
  earlyId: string | null;
  /** Its flagged tasks ("N tasks need shifting"). */
  flagged: number;
};
export type AttendanceToday = { dayKey: string; tz: string; people: TodayPerson[]; banners: EarlyBanner[]; questions: BackQuestion[] };

const KIND_TEXT: Record<DayKind, string> = {
  WORKING: "Not marked",
  HALF: "Half day",
  OFF_WEEKLY: "Weekly off",
  HOLIDAY: "Holiday",
  LEAVE: "On leave",
  ABSENT: "Absent",
  AWAY: "Away",
};

export async function attendanceToday(now = new Date()): Promise<AttendanceToday> {
  const s = await getSettings();
  const cfg = toWorkingConfig(s);
  const tz = cfg.timezone;
  const key = dateKey(now, tz);
  const staff = await prisma.user.findMany({
    where: { active: true, role: { in: ["TEAM_LEADER", "EXECUTIVE"] } },
    select: { id: true, name: true, role: true, team: { select: { name: true } } },
    orderBy: [{ name: "asc" }],
  });
  const ids = staff.map((u) => u.id);
  const [availability, early, banners, questions] = await Promise.all([
    loadPeople(ids).then((people) => loadAvailability(people, key, key, cfg)),
    earlyToday(ids, now),
    earlyBanners(now),
    backQuestions(now),
  ]);
  const people = staff.map((u): TodayPerson => {
    const d = availability.day(u.id, key);
    const status = d.away ? dayAwayLabel(d.away, tz) : d.kind === "WORKING" && d.marked === "PRESENT" ? "Present" : KIND_TEXT[d.kind];
    return {
      id: u.id,
      name: u.name,
      sub: [u.team?.name, u.role === "TEAM_LEADER" ? "team leader" : "executive"].filter(Boolean).join(" · "),
      status,
      away: !!d.away,
      earlyId: early[u.id]?.id ?? null,
      flagged: early[u.id]?.flagged ?? 0,
    };
  });
  return { dayKey: key, tz, people, banners, questions };
}
