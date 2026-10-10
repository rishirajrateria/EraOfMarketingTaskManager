/**
 * Top summary of the dashboard ("OPEN HOURS", prototype `pillGroups`, ADR 0015). Pure — unit-tested in tests/ui.
 *
 * Two groups of tiles (the add-task capacity tile design) — work hours + number of open tasks:
 * - Admin: TEAMS (or "<Team> · people" — its Team Leader + executives — once a team is picked in the dock) + CLIENTS;
 * - Team Leader: PEOPLE (their executives) + CLIENTS;
 * - Executive: DAYS (Today / Tom / Day+2) + CLIENTS.
 * The numbers follow the dock filters (team / person / client, client / work, day); the strip filters (colours, icons,
 * completed) and the summary's own selection don't narrow them. Tiles without open tasks are hidden unless selected.
 */
import { formatInTimeZone } from "date-fns-tz";
import type { DashboardData, DashboardFilters, PillGroup, TaskRow } from "@/server/tasks/types";
import { dateKey } from "@/lib/time";
import { pillHours } from "@/components/dashboard/format";
import { dayKeys, matchesFilters, type FilterCtx } from "@/components/dashboard/filters";

const work = (t: TaskRow) => (t.type === "WORK" ? t.allocatedMinutes : 0);
const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** The dock filters only: what the summary numbers are computed over (open tasks). */
export function dockFilters(f: DashboardFilters): DashboardFilters {
  return { ...f, pill: null, colours: [], icons: [], completed: false, recurringOnly: false, pausedOnly: false, quick: f.quick === "asc" ? null : f.quick };
}

export function summaryGroups(data: Pick<DashboardData, "role" | "tasks" | "teams" | "clients" | "people" | "row1" | "me" | "tz" | "nextLeaveKey">, f: DashboardFilters, now = new Date()): PillGroup[] {
  const ctx: FilterCtx = { role: data.role, meId: data.me.id, tz: data.tz, now, nextLeaveKey: data.nextLeaveKey };
  const keys = dayKeys(now, data.tz);
  const scoped = dockFilters(f);
  const tasks = data.tasks.filter((t) => matchesFilters(t, scoped, ctx, keys));
  /** One tile: work hours (meetings don't count as hours) + the number of open tasks. */
  const tile = (id: string, label: string, pred: (t: TaskRow) => boolean) => {
    const hit = tasks.filter(pred);
    return { id, label, minutes: hit.reduce((a, t) => a + work(t), 0), count: hit.length };
  };
  const keep = (it: { id: string; count: number }) => it.count > 0 || f.pill === it.id;
  const person = (p: { id: string; name: string }) => tile(`person:${p.id}`, first(p.name), (t) => t.assignees.some((a) => a.id === p.id));
  const clients: PillGroup = { key: "client", label: "Clients", items: data.clients.map((c) => tile(`client:${c.id}`, c.name, (t) => t.client.id === c.id)).filter(keep) };

  if (data.role === "ADMIN") {
    const team = f.row1 ? data.teams.find((t) => t.id === f.row1) : undefined;
    if (team) {
      const members = data.people.filter((p) => p.teamId === team.id && (p.role === "TEAM_LEADER" || p.role === "EXECUTIVE"));
      // Team Leader first, then executives (alphabetical as loaded).
      members.sort((a, b) => (a.role === b.role ? 0 : a.role === "TEAM_LEADER" ? -1 : 1));
      return [{ key: "person", label: `${team.name} · people`, items: members.map(person).filter(keep) }, clients];
    }
    return [{ key: "team", label: "Teams", items: data.teams.map((t) => tile(`team:${t.id}`, t.name, (x) => x.teams.some((y) => y.id === t.id))).filter(keep) }, clients];
  }
  if (data.role === "TEAM_LEADER") {
    const execs = data.row1.map((r) => data.people.find((p) => p.id === r.id)).filter((p): p is DashboardData["people"][number] => !!p);
    return [{ key: "person", label: "People", items: execs.map(person).filter(keep) }, clients];
  }
  const days: PillGroup = {
    key: "date",
    label: "Days",
    items: [
      tile("date:today", "Today", (t) => !!t.scheduledStart && dayKey(t.scheduledStart, data.tz) === keys.today),
      tile("date:tomorrow", "Tom", (t) => !!t.scheduledStart && dayKey(t.scheduledStart, data.tz) === keys.tomorrow),
      tile("date:day2", "Day+2", (t) => !!t.scheduledStart && dayKey(t.scheduledStart, data.tz) === keys.day2),
    ],
  };
  return [days, clients];
}

const dayKey = (iso: string, tz: string) => dateKey(new Date(iso), tz);

/** Caption on the right of the first group: the active dock filters ("Social · Zenith Foods · Tomorrow") or "all tasks". */
export function summaryCaption(data: Pick<DashboardData, "row1" | "row2">, f: DashboardFilters): string {
  const parts = [
    f.row1 ? data.row1.find((r) => r.id === f.row1)?.label : null,
    f.row2 ? data.row2.find((r) => r.id === f.row2)?.label : null,
    dayLabel(f, true),
  ].filter((x): x is string => !!x);
  return parts.length ? parts.join(" · ") : "all tasks";
}

/** Day chip / caption text: "08 Oct", "Today", "Tomorrow" (chip: "Tom"), null when any day. */
export function dayLabel(f: Pick<DashboardFilters, "date" | "quick">, long = false): string | null {
  if (f.date) return formatInTimeZone(new Date(`${f.date}T12:00:00Z`), "UTC", "dd MMM");
  if (f.quick === "today") return "Today";
  if (f.quick === "tomorrow") return long ? "Tomorrow" : "Tom";
  return null;
}

/** "11.8h", "4h"; under an hour "30m" (never "0.5h" / "0h 30m"); nothing "0h". */
export const hoursText = (minutes: number) => (minutes > 0 && minutes < 60 ? `${Math.round(minutes)}m` : `${pillHours(minutes)}h`);
