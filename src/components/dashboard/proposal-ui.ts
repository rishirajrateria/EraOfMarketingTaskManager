/**
 * Pure presentation helpers for Team Leader proposals and Admin's person chip (ADR 0021, prototype `personName`,
 * `proposalCard`). No React — unit-tested in tests/ui.
 */
import type { DashboardData, TaskRow } from "@/server/tasks/types";

/** The add-task caption for a Team Leader's work task (prototype `#tSlot`). */
export const PROPOSAL_SENT = "Sent to Admin for approval · no time blocked until approved";
/** Its Save button (prototype `saveBtn`). */
export const PROPOSAL_SUBMIT = "Send to Admin";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const firstOf = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] || "";

/** "2026-10-13" → "13 Oct". */
export const shortDay = (key: string) => `${Number(key.slice(8, 10))} ${MONTHS[Number(key.slice(5, 7)) - 1] ?? ""}`.trim();

/** "14:30" → "2:30 pm". */
export function time12(hm: string): string {
  const [h, m] = hm.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, "0")} ${suffix}` : `${h12} ${suffix}`;
}

export const isProposal = (t: Pick<TaskRow, "status" | "proposal">) => t.status === "PENDING_APPROVAL" || !!t.proposal;

/** The card's date pill while pending: "Due 13 Oct" (deadline) · "13 Oct" (a requested day) · "Up next". */
export function proposalDatePill(t: Pick<TaskRow, "deadlineOnly" | "proposal">): string {
  const day = t.proposal?.requestedDate;
  if (t.deadlineOnly) return day ? `Due ${shortDay(day)}` : "Deadline";
  return day ? shortDay(day) : "Up next";
}

/** What the Team Leader asked for, for Admin: "due 13 Oct" · "wants 13 Oct 2:30 pm" · "wants 13 Oct" · "up next". */
export function proposalWants(t: Pick<TaskRow, "deadlineOnly" | "proposal">): string {
  const p = t.proposal;
  if (t.deadlineOnly) return p?.requestedDate ? `due ${shortDay(p.requestedDate)}` : "deadline";
  if (!p?.requestedDate) return "up next";
  return `wants ${shortDay(p.requestedDate)}${p.requestedTime ? ` ${time12(p.requestedTime)}` : ""}`;
}

type People = Pick<DashboardData, "people">["people"];

/**
 * Admin's person chip (prototype `personName`): a proposal → its Team Leader; otherwise the executive(s) on the task,
 * else whoever holds it (the Team Leader before an executive is picked). "Arjun", "Arjun +1"; "" when nobody.
 */
export function personChip(t: Pick<TaskRow, "assignees" | "proposal">, people: People): string {
  if (t.proposal) return firstOf(people.find((p) => p.id === t.proposal!.byId)?.name);
  const roleOf = (id: string) => people.find((p) => p.id === id)?.role;
  const execs = t.assignees.filter((a) => roleOf(a.id) === "EXECUTIVE");
  const ids = execs.length ? execs : t.assignees;
  if (!ids.length) return "";
  return firstOf(ids[0]!.name) + (ids.length > 1 ? ` +${ids.length - 1}` : "");
}

/** The proposer's name for sheets and toasts ("Rishi"). */
export const proposerName = (t: Pick<TaskRow, "proposal" | "createdById">, people: People) =>
  firstOf(people.find((p) => p.id === (t.proposal?.byId ?? t.createdById))?.name) || "the Team Leader";
