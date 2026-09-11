/** Pure presentation helpers for dashboard rows and the detail sheet. Unit-tested in tests/ui. */
import type { TaskRow } from "@/server/tasks/types";

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";

/** "Graphic" → "GR" (SPEC §5.2 team chip). */
export const teamCode = (name: string) => name.replace(/[^a-z]/gi, "").slice(0, 2).toUpperCase();

/**
 * Team/assignee chip (SPEC §5.2): "Me" when I am the only assignee, the team short code when one team,
 * "we" when several teams or several assignees, else the assignee's first name.
 */
export function assigneeChip(t: Pick<TaskRow, "assignees" | "teams">, meId: string): string {
  if (t.assignees.length === 1 && t.assignees[0]!.id === meId) return "Me";
  if (t.assignees.length > 1 || t.teams.length > 1) return "we";
  if (t.teams.length === 1) return teamCode(t.teams[0]!.name);
  if (t.assignees.length === 1) return firstName(t.assignees[0]!.name);
  return "—";
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
