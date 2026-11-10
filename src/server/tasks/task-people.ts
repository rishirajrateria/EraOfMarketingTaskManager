/**
 * Who a work task's Google resources include (ADR 0015). Pure — the queue handlers load the people and call this.
 *
 * - `internal` (Drive folder sharing + Chat space members): the assigned people, the Team Leader(s) of the task's
 *   team(s) (and an assignee's own Team Leader for team-less legacy rows), every active executive of those teams, and
 *   the creator. Never external guests.
 * - `calendar` (Calendar attendees — the event blocks their calendars, which feeds availability): the assigned people,
 *   the Team Leaders above, the creator and the Admins. Team executives who are not assigned are NOT invited, so
 *   their free/busy stays free.
 */
import { normaliseEmails } from "@/server/tasks/meeting";

export type TeamMember = { email: string; role: string; active: boolean };

export type WorkTaskPeopleInput = {
  assignees: { email: string; teamLeaderEmail?: string | null }[];
  /** Members of the task's teams (any role; inactive ones and Admins / HR are ignored). */
  teamMembers: TeamMember[];
  /** `Team.leader` of each of the task's teams. */
  teamLeaderEmails: (string | null | undefined)[];
  creatorEmail: string;
  adminEmails: string[];
};

export function workTaskPeople(p: WorkTaskPeopleInput): { internal: string[]; calendar: string[] } {
  const assigned = p.assignees.map((a) => a.email);
  const leaders = [
    ...p.assignees.map((a) => a.teamLeaderEmail),
    ...p.teamLeaderEmails,
    ...p.teamMembers.filter((m) => m.active && m.role === "TEAM_LEADER").map((m) => m.email),
  ];
  const executives = p.teamMembers.filter((m) => m.active && m.role === "EXECUTIVE").map((m) => m.email);
  return {
    internal: normaliseEmails([...assigned, ...leaders, ...executives, p.creatorEmail]),
    calendar: normaliseEmails([...assigned, ...leaders, p.creatorEmail, ...p.adminEmails]),
  };
}
