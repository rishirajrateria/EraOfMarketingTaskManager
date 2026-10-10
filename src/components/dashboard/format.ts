/** Pure presentation helpers for dashboard rows and the detail sheet. Unit-tested in tests/ui. */
import { formatInTimeZone } from "date-fns-tz";
import type { TaskRow } from "@/server/tasks/types";

/** DOM id of the attachments block in TaskDetailSheet (the row's mic icon opens the sheet scrolled to it). */
export const ATTACHMENTS_ANCHOR = "task-attachments";

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";

/** "Graphic" → "GR" (SPEC §5.2 team chip). */
export const teamCode = (name: string) => name.replace(/[^a-z]/gi, "").slice(0, 2).toUpperCase();

/** Team chip on the card (ADR 0015): the task's team, "Social +1" for several, null for none. */
export function teamChipLabel(teams: Pick<TaskRow, "teams">["teams"]): string | null {
  if (!teams.length) return null;
  return teams.length === 1 ? teams[0]!.name : `${teams[0]!.name} +${teams.length - 1}`;
}

/** Date pill (ADR 0015): always the task's start date, "08 Oct" — never Today / Tom / Yest. */
export const datePill = (d: Date | string | null | undefined, tz: string) => (d ? formatInTimeZone(new Date(d), tz, "dd MMM") : "Unsched");

export type TaskPeople = { teams: string[]; leaders: string[]; assigned: string[]; preferred: string[] };

/**
 * Who the task is with, for the (i) details sheet (the card no longer shows people, ADR 0015): its team(s), their Team
 * Leader(s), the assigned person(s) and Admin's executive preference (ADR 0008).
 */
export function taskPeople(t: Pick<TaskRow, "teams" | "assignees" | "preferredAssigneeIds">, people: { id: string; name: string; role: string; teamId: string | null }[]): TaskPeople {
  const teamIds = new Set(t.teams.map((x) => x.id));
  return {
    teams: t.teams.map((x) => x.name),
    leaders: people.filter((p) => p.role === "TEAM_LEADER" && p.teamId && teamIds.has(p.teamId)).map((p) => p.name),
    assigned: t.assignees.map((a) => a.name),
    preferred: t.preferredAssigneeIds.map((id) => people.find((p) => p.id === id)?.name).filter((n): n is string => !!n),
  };
}

/** Human status label for the detail sheet. */
export function statusLabel(t: Pick<TaskRow, "status" | "overdue" | "doubtRaised" | "paused" | "type">): string {
  if (t.status === "COMPLETED") return "Completed";
  if (t.paused) return "Paused";
  if (t.doubtRaised) return "Doubt raised";
  if (t.status === "FINISH_REQUESTED") return "Finish requested";
  if (t.status === "STARTED") return t.overdue ? "Ongoing · overdue" : "Ongoing";
  if (t.type === "MEETING") return "Meeting";
  return t.overdue ? "Not started · overdue" : "Assigned";
}

/**
 * Minimal HTML sanitiser for the rich-text description (authored in-app, but never trust stored markup):
 * drops script/style/iframe/object/embed, inline event handlers and javascript: URLs.
 */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*\/?\s*(script|style|iframe|object|embed)\b[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/<\s*\/?\s*(form|meta|link|base|svg|math)\b[^>]*>/gi, "")
    .replace(/\s(href|src|action|formaction|xlink:href)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (_m, attr: string, _q, d?: string, sq?: string, bare?: string) => {
      const raw = (d ?? sq ?? bare ?? "").replace(/&#x([0-9a-f]+);?/gi, (_x, h: string) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);?/g, (_x, n: string) => String.fromCharCode(Number(n)));
      const url = raw.replace(/[\u0000-\u0020]/g, "").toLowerCase();
      return /^(https?:|mailto:|\/|#)/.test(url) || url === "" ? ` ${attr}="${raw.replace(/"/g, "&quot;")}"` : ` ${attr}="#"`;
    });
}

/** Deterministic pseudo-random bar heights (px) for a voice-note waveform, seeded by id. */
export function waveformHeights(seed: string, bars = 24, max = 22): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const out: number[] = [];
  for (let i = 0; i < bars; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    out.push(4 + ((h >>> 0) % (max - 4)));
  }
  return out;
}

export const fmtSeconds = (s: number | null) => (s == null ? "" : `${Math.round(s)}s`);

/** Minutes → "5", "5.5", "16.5" (one decimal max, no unit); the summary adds "h". */
export function pillHours(minutes: number): string {
  const h = Math.round((minutes / 60) * 10) / 10;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

/** 24h "H:mm" clock (no am/pm, no leading zero — "4:45", "17:00") in the company timezone; "--:--" when unset. */
export const fmtClock = (d: Date | string | null | undefined, tz: string) => (d ? formatInTimeZone(new Date(d), tz, "H:mm") : "--:--");

/** "31/4/25" (d/M/yy) full date under the date chip. */
export const fmtShortDate = (d: Date | string | null | undefined, tz: string) => (d ? formatInTimeZone(new Date(d), tz, "d/M/yy") : "");
