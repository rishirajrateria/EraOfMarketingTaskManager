/** ADR 0021 — proposal cards, Admin's person chip and PEOPLE filter row, the feed kinds. Pure, no DB. */
import { describe, expect, it } from "vitest";
import { applyFilters, normaliseFilters, type FilterCtx } from "@/components/dashboard/filters";
import { personChip, proposalDatePill, proposalWants, time12, PROPOSAL_SENT, PROPOSAL_SUBMIT } from "@/components/dashboard/proposal-ui";
import { approvedToast } from "@/components/dashboard/proposal-toast";
import { peopleRow } from "@/components/dashboard/BottomBar";
import { summaryCaption, summaryGroups } from "@/components/dashboard/summary";
import { statusLabel } from "@/components/dashboard/format";
import { KIND_META, kindsOfGroup, notificationTarget } from "@/lib/notification-kinds";
import { PROPOSAL_FEED_KINDS, inScope } from "@/lib/notification-scope";
import { movedToPhrase, movedToYouPhrase, proposalApprovedPhrase, proposalRejectedPhrase, proposedPhrase } from "@/lib/notification-text";
import { DEFAULT_FILTERS, type DashboardData, type TaskRow } from "@/server/tasks/types";

const TZ = "Asia/Kolkata";
const NOW = new Date("2026-09-10T06:00:00Z"); // Thu 10 Sep 11:30 IST
const people: DashboardData["people"] = [
  { id: "tl", name: "Rishi Sharma", role: "TEAM_LEADER", teamId: "g", teamLeaderId: null, specialityIds: [] },
  { id: "ex", name: "Arush Kumar", role: "EXECUTIVE", teamId: "g", teamLeaderId: "tl", specialityIds: [] },
  { id: "ex2", name: "Neha Verma", role: "EXECUTIVE", teamId: "g", teamLeaderId: "tl", specialityIds: [] },
  { id: "ad", name: "Admin", role: "ADMIN", teamId: null, teamLeaderId: null, specialityIds: [] },
];

let seq = 0;
const row = (p: Partial<TaskRow> = {}): TaskRow =>
  ({
    id: `t${++seq}`,
    title: "Task",
    type: "WORK",
    status: "ASSIGNED",
    colour: "white",
    paused: false,
    recurring: false,
    doubtRaised: false,
    reviewRequested: false,
    important: false,
    client: { id: "c1", name: "Repo" },
    teams: [{ id: "g", name: "Graphic", colour: "#000" }],
    assignees: [{ id: "tl", name: "Rishi Sharma", avatar: null }],
    preferredAssigneeIds: [],
    tags: [],
    allocatedMinutes: 120,
    scheduledStart: "2026-09-10T04:30:00Z",
    scheduledEnd: "2026-09-10T06:30:00Z",
    parentTaskId: null,
    childTaskId: null,
    createdById: "tl",
    proposal: null,
    ...p,
  }) as TaskRow;
const pending = (p: Partial<TaskRow> = {}) => row({ status: "PENDING_APPROVAL", assignees: [], scheduledStart: null, scheduledEnd: null, proposal: { byId: "tl", requestedDate: null, requestedTime: null }, ...p });
const ctx: FilterCtx = { role: "ADMIN", meId: "ad", tz: TZ, now: NOW };

describe("proposal cards (ADR 0021)", () => {
  it("the date pill and Admin's 'wants' line read the TL's preferred slot", () => {
    expect(proposalDatePill(pending())).toBe("Up next");
    expect(proposalDatePill(pending({ proposal: { byId: "tl", requestedDate: "2026-10-13", requestedTime: "15:00" } }))).toBe("13 Oct");
    expect(proposalDatePill(pending({ deadlineOnly: true, proposal: { byId: "tl", requestedDate: "2026-10-13", requestedTime: null } }))).toBe("Due 13 Oct");
    expect(proposalWants(pending({ proposal: { byId: "tl", requestedDate: "2026-10-13", requestedTime: "14:30" } }))).toBe("wants 13 Oct 2:30 pm");
    expect(proposalWants(pending())).toBe("up next");
    expect(time12("09:00")).toBe("9 am");
    expect(statusLabel(pending())).toBe("Waiting for Admin · no time held");
    expect([PROPOSAL_SENT, PROPOSAL_SUBMIT]).toEqual(["Sent to Admin for approval · no time blocked until approved", "Send to Admin"]);
  });

  it("Admin's person chip: the executive, else the Team Leader holding it; a proposal shows its TL", () => {
    expect(personChip(row(), people)).toBe("Rishi");
    expect(personChip(row({ assignees: [{ id: "tl", name: "Rishi Sharma", avatar: null }, { id: "ex", name: "Arush Kumar", avatar: null }] }), people)).toBe("Arush");
    expect(personChip(row({ assignees: [{ id: "ex", name: "Arush Kumar", avatar: null }, { id: "ex2", name: "Neha Verma", avatar: null }] }), people)).toBe("Arush +1");
    expect(personChip(pending(), people)).toBe("Rishi");
    expect(personChip(row({ assignees: [] }), people)).toBe("");
  });

  it("the PEOPLE row lists Team Leaders and executives and filters by assignee (a proposal by its TL)", () => {
    expect(peopleRow({ role: "ADMIN", people }).map((p) => p.label)).toEqual(["Rishi", "Arush", "Neha"]);
    expect(peopleRow({ role: "TEAM_LEADER", people })).toEqual([]);
    const a = row({ assignees: [{ id: "ex", name: "Arush Kumar", avatar: null }] });
    const b = row();
    const p = pending();
    const ids = (r: TaskRow[]) => r.map((t) => t.id);
    expect(ids(applyFilters([a, b, p], { ...DEFAULT_FILTERS, row3: "ex" }, ctx))).toEqual([a.id]);
    expect(ids(applyFilters([a, b, p], { ...DEFAULT_FILTERS, row3: "tl" }, ctx))).toEqual([b.id, p.id]);
    expect(ids(applyFilters([a, b, p], { ...DEFAULT_FILTERS, row3: null }, ctx))).toEqual([a.id, b.id, p.id]);
    expect(normaliseFilters({ row3: "ex" }).row3).toBe("ex");
    expect(summaryCaption({ row1: [], row2: [], people }, { ...DEFAULT_FILTERS, row3: "ex" })).toBe("Arush");
  });

  it("a proposal never counts in the dashboard hours tiles", () => {
    const data = { role: "ADMIN" as const, tasks: [row(), pending({ allocatedMinutes: 480 })], teams: [{ id: "g", name: "Graphic", colour: "#000" }], clients: [{ id: "c1", name: "Repo" }], people, row1: [], me: { id: "ad", role: "ADMIN", teamId: null }, tz: TZ, nextLeaveKey: null };
    const [teams] = summaryGroups(data, DEFAULT_FILTERS, NOW);
    expect(teams!.items).toEqual([{ id: "team:g", label: "Graphic", minutes: 120, count: 1 }]);
  });

  it("the approval toast: the requested time, else '· next free slot'", () => {
    expect(approvedToast({ start: "2026-09-10T09:30:00Z", onRequested: true }, false, TZ, NOW)).toBe("Approved · Today 3 pm");
    expect(approvedToast({ start: "2026-09-11T04:30:00Z", onRequested: false }, false, TZ, NOW)).toBe("Approved · Fri 11 Sep 10 am · next free slot");
    expect(approvedToast({ start: "2026-09-11T13:30:00Z", onRequested: true }, true, TZ, NOW)).toBe("Approved · due 11 Sep");
  });
});

describe("notification kinds (ADR 0021)", () => {
  it("are task updates in the Tasks filter with their own colours", () => {
    expect(PROPOSAL_FEED_KINDS.every((k) => KIND_META[k].group === "TASKS")).toBe(true);
    expect(kindsOfGroup("TASKS")).toEqual(expect.arrayContaining([...PROPOSAL_FEED_KINDS]));
    expect([KIND_META.TASK_PROPOSED.label, KIND_META.TASK_PROPOSAL_APPROVED.tone, KIND_META.TASK_PROPOSAL_REJECTED.tone, KIND_META.TASK_REASSIGNED.label]).toEqual(["Proposal", "green", "red", "Moved"]);
  });

  it("a waiting proposal opens Admin's Requests → Work; a rejected (deleted) one goes nowhere", () => {
    const base = { href: null, taskId: "t1", invoiceId: null };
    expect(notificationTarget({ ...base, kind: "TASK_PROPOSED", task: { status: "PENDING_APPROVAL", deleted: false } }, "ADMIN")).toBe("/admin/requests?tab=WORK");
    expect(notificationTarget({ ...base, kind: "TASK_PROPOSED", task: { status: "ASSIGNED", deleted: false } }, "ADMIN")).toBe("/dashboard?task=t1");
    expect(notificationTarget({ ...base, kind: "TASK_PROPOSAL_REJECTED", task: { status: "PENDING_APPROVAL", deleted: true } }, "TEAM_LEADER")).toBeNull();
    expect(notificationTarget({ ...base, kind: "TASK_REASSIGNED", task: { status: "ASSIGNED", deleted: false } }, "EXECUTIVE")).toBe("/dashboard?task=t1");
  });

  it("scope by the task's team and client, deleted proposals included", () => {
    const lookup = { tasks: new Map([["t1", { clientId: "c1", teamIds: ["g"] }]]), invoices: new Map() };
    expect(inScope({ taskId: "t1", invoiceId: null }, { team: "g", client: "c1" }, lookup)).toBe(true);
    expect(inScope({ taskId: "t1", invoiceId: null }, { team: "x", client: null }, lookup)).toBe(false);
  });

  it("phrases", () => {
    expect([proposedPhrase("Rishi Sharma"), proposalApprovedPhrase("Tomorrow 3 pm"), proposalRejectedPhrase("Not now"), movedToPhrase("Arjun"), movedToYouPhrase("Admin")]).toEqual([
      "New proposal from Rishi",
      "Approved · Tomorrow 3 pm · you can now assign an executive",
      "Rejected: Not now",
      "Task moved to Arjun",
      "Task moved to you · by Admin",
    ]);
  });
});
