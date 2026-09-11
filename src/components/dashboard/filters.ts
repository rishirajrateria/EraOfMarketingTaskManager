/**
 * Pure dashboard filtering + sorting (SPEC §5.1, §5.4). No React, no DB — unit-tested in tests/ui.
 *
 * Semantics:
 * - Groups combine with AND (colour strip, icon strip, row1, row2, pill, date, quick, toggles).
 * - Inside a multi-select group (colours / icons) items combine with OR.
 * - COMPLETED rows are hidden unless `filters.completed` is on.
 */
import { addDays } from "date-fns";
import { dateKey, zonedStartOfDay } from "@/lib/time";
import type { DashboardData, DashboardFilters, TaskRow } from "@/server/tasks/types";

export type FilterCtx = {
  role: DashboardData["role"];
  meId: string;
  tz: string;
  now?: Date;
  /** yyyy-MM-dd of the user's next approved leave; tasks before it satisfy the B4Leave pill. Unknown → no-op. */
  nextLeaveKey?: string | null;
};

export type IconFilter = DashboardFilters["icons"][number];

export function hasIcon(t: TaskRow, icon: IconFilter): boolean {
  switch (icon) {
    case "paused":
      return t.paused;
    case "doubt":
      return t.doubtRaised;
    case "review":
      return t.reviewRequested;
    case "important":
      return t.important;
    case "recurring":
      return t.recurring;
    case "restarted":
      // A restart copy (has a parent) or a completed original that was restarted (has a child).
      return t.parentTaskId != null || (t.status === "COMPLETED" && t.childTaskId != null);
    default:
      return false;
  }
}

function startKey(t: TaskRow, tz: string): string | null {
  return t.scheduledStart ? dateKey(new Date(t.scheduledStart), tz) : null;
}

export function dayKeys(now: Date, tz: string) {
  const today = dateKey(now, tz);
  const tomorrow = dateKey(addDays(zonedStartOfDay(now, tz), 1), tz);
  return { today, tomorrow };
}

/** Row-1 pill meaning depends on role (SPEC §5.4). */
function matchesRow1(t: TaskRow, id: string, role: FilterCtx["role"]): boolean {
  if (role === "ADMIN") return t.teams.some((x) => x.id === id);
  if (role === "TEAM_LEADER") return t.assignees.some((a) => a.id === id);
  return t.client.id === id;
}

function matchesRow2(t: TaskRow, id: string, role: FilterCtx["role"]): boolean {
  if (role === "EXECUTIVE") return t.tags.some((x) => x.id === id);
  return t.client.id === id;
}

/** Blue-area pill: "team:<id>" | "person:<id>" | "client:<id>" | "date:today|tomorrow|b4leave|all". */
export function matchesPill(t: TaskRow, pill: string, ctx: FilterCtx, keys: { today: string; tomorrow: string }): boolean {
  const idx = pill.indexOf(":");
  if (idx < 0) return true;
  const kind = pill.slice(0, idx);
  const value = pill.slice(idx + 1);
  switch (kind) {
    case "team":
      return t.teams.some((x) => x.id === value);
    case "person":
      return t.assignees.some((a) => a.id === value);
    case "client":
      return t.client.id === value;
    case "date": {
      const k = startKey(t, ctx.tz);
      if (value === "all") return true;
      if (value === "today") return k === keys.today;
      if (value === "tomorrow") return k === keys.tomorrow;
      if (value === "b4leave") return ctx.nextLeaveKey ? k !== null && k < ctx.nextLeaveKey : true;
      return true;
    }
    default:
      return true;
  }
}

export function matchesFilters(t: TaskRow, f: DashboardFilters, ctx: FilterCtx, keys: { today: string; tomorrow: string }): boolean {
  if (t.status === "COMPLETED" && !f.completed) return false;
  if (f.colours.length && !f.colours.includes(t.colour)) return false;
  if (f.icons.length && !f.icons.some((i) => hasIcon(t, i))) return false;
  if (f.row1 && !matchesRow1(t, f.row1, ctx.role)) return false;
  if (f.row2 && !matchesRow2(t, f.row2, ctx.role)) return false;
  if (f.pill && !matchesPill(t, f.pill, ctx, keys)) return false;
  if (f.date && startKey(t, ctx.tz) !== f.date) return false;
  if (f.quick === "today" && startKey(t, ctx.tz) !== keys.today) return false;
  if (f.quick === "tomorrow" && startKey(t, ctx.tz) !== keys.tomorrow) return false;
  if (f.recurringOnly && !t.recurring) return false;
  if (f.pausedOnly && !t.paused) return false;
  return true;
}

/** Ascending by scheduled start; unscheduled rows last; stable for equal keys. */
export function sortAscending(tasks: TaskRow[]): TaskRow[] {
  return tasks
    .map((t, i) => ({ t, i }))
    .sort((a, b) => {
      const ka = a.t.scheduledStart ?? "~";
      const kb = b.t.scheduledStart ?? "~";
      return ka < kb ? -1 : ka > kb ? 1 : a.i - b.i;
    })
    .map((x) => x.t);
}

/** Default order: server order (scheduled start asc), but important and red rows are not reordered — the Canva
 *  design shows a plain time-ordered list; only the "Ascending" quick pill forces an explicit sort. */
export function applyFilters(tasks: TaskRow[], f: DashboardFilters, ctx: FilterCtx): TaskRow[] {
  const keys = dayKeys(ctx.now ?? new Date(), ctx.tz);
  const out = tasks.filter((t) => matchesFilters(t, f, ctx, keys));
  return f.quick === "asc" ? sortAscending(out) : out;
}

const COLOURS = new Set<string>(["white", "green", "yellow", "red", "grey"]);
const ICONS = new Set<string>(["paused", "doubt", "review", "important", "recurring", "restarted"]);
const QUICK = new Set<string>(["asc", "tomorrow", "today"]);

/** Coerce the persisted JSON (prisma `User.filterPrefs`) into a well-typed filter set; unknown values are dropped. */
export function normaliseFilters(raw: unknown): DashboardFilters {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const strOrNull = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
  const list = (v: unknown, allowed: Set<string>) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && allowed.has(x)) : []);
  const quick = strOrNull(r.quick);
  return {
    colours: list(r.colours, COLOURS) as DashboardFilters["colours"],
    icons: list(r.icons, ICONS) as DashboardFilters["icons"],
    row1: strOrNull(r.row1),
    row2: strOrNull(r.row2),
    pill: strOrNull(r.pill),
    date: typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null,
    quick: quick && QUICK.has(quick) ? (quick as DashboardFilters["quick"]) : null,
    completed: r.completed === true,
    recurringOnly: r.recurringOnly === true,
    pausedOnly: r.pausedOnly === true,
  };
}

/** Toggle helper for multi-select arrays (colour swatches / icon toggles). */
export function toggleIn<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

/** Count of active filter dimensions (for a "clear" affordance). */
export function activeFilterCount(f: DashboardFilters): number {
  let n = 0;
  if (f.colours.length) n++;
  if (f.icons.length) n++;
  if (f.row1) n++;
  if (f.row2) n++;
  if (f.pill) n++;
  if (f.date) n++;
  if (f.quick) n++;
  if (f.completed) n++;
  if (f.recurringOnly) n++;
  if (f.pausedOnly) n++;
  return n;
}
