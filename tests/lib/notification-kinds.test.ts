import { describe, expect, it } from "vitest";
import { NotificationKind } from "@prisma/client";
import { FEED_HIDDEN_KINDS, FEED_KINDS, KIND_META, dayLabel, feedHref, groupByDay, isFeedKind, kindsOfGroup, notificationTarget, parseFeedFilter, taskDeepLink } from "@/lib/notification-kinds";
import { completedPhrase, fmtSpan, leaveDays, notStartedPhrase, pastEndPhrase, startPhrase } from "@/lib/notification-text";
import { planDeepLink, strippedDashboardUrl } from "@/components/dashboard/deep-link";

const TZ = "Asia/Kolkata";
const ist = (s: string) => new Date(`${s}+05:30`);

describe("notification kinds (ADR 0017)", () => {
  it("every kind has a colour, label, icon and group; decisions are not feed kinds", () => {
    for (const k of Object.values(NotificationKind)) expect(KIND_META[k], k).toBeDefined();
    expect(FEED_HIDDEN_KINDS).toEqual(["PAYMENT_DUE", "INVOICE_APPROVAL_DUE"]);
    expect(isFeedKind("PAYMENT_DUE")).toBe(false);
    expect(FEED_KINDS).not.toContain("INVOICE_APPROVAL_DUE");
    expect(kindsOfGroup("MONEY")).toEqual(expect.arrayContaining(["INVOICE_PAID", "PAYMENT_RECEIVED", "TDS_THRESHOLD"]));
    expect(kindsOfGroup("MONEY")).not.toContain("PAYMENT_DUE");
    expect(kindsOfGroup("PEOPLE")).toEqual(expect.arrayContaining(["LEAVE_APPROVED", "LEAVE_REJECTED", "LEAVE_REQUESTED"]));
    expect(kindsOfGroup("TASKS")).toEqual(expect.arrayContaining(["TASK_STARTED_LATE", "TASK_NOT_STARTED", "TASK_PAST_END", "TASK_COMPLETED", "GENERIC"]));
  });

  it("colours follow the task card", () => {
    const tone = (k: NotificationKind) => KIND_META[k].tone;
    expect([tone("TASK_STARTED"), tone("FINISH_REQUESTED"), tone("PAYMENT_RECEIVED")]).toEqual(["green", "green", "green"]);
    expect([tone("TASK_STARTED_LATE"), tone("TASK_NOT_STARTED"), tone("TASK_PAST_END"), tone("WORK_ON_HOLD")]).toEqual(["red", "red", "red", "red"]);
    expect(tone("TASK_PAUSED")).toBe("yellow");
    expect([tone("DOUBT_RAISED"), tone("DOUBT_RESOLVED")]).toEqual(["purple", "purple"]);
    expect(tone("TASK_COMPLETED")).toBe("grey");
    expect(tone("TASK_ASSIGNED")).toBe("blue");
    expect(tone("LEAVE_APPROVED")).toBe("amber");
  });

  it("filters parse from the URL", () => {
    expect(parseFeedFilter("unread")).toBe("UNREAD");
    expect(parseFeedFilter("MONEY")).toBe("MONEY");
    expect(parseFeedFilter("nope")).toBe("ALL");
    expect(parseFeedFilter(undefined)).toBe("ALL");
    expect(feedHref("ALL")).toBe("/notifications");
    expect(feedHref("PEOPLE")).toBe("/notifications?show=PEOPLE");
  });

  it("tap targets: task deep link, invoice page, leave per role, nothing for gone tasks", () => {
    expect(taskDeepLink("t1")).toBe("/dashboard?task=t1");
    expect(taskDeepLink("t1", { completed: true })).toBe("/dashboard?task=t1&completed=1");
    const n = { kind: "TASK_STARTED_LATE" as const, href: "/dashboard?task=t1", taskId: "t1", invoiceId: null, task: { status: "STARTED", deleted: false } };
    expect(notificationTarget(n, "TEAM_LEADER")).toBe("/dashboard?task=t1");
    expect(notificationTarget({ ...n, task: { status: "COMPLETED", deleted: false } }, "ADMIN")).toBe("/dashboard?task=t1&completed=1");
    expect(notificationTarget({ ...n, kind: "TASK_COMPLETED" }, "EXECUTIVE")).toBe("/dashboard?task=t1&completed=1");
    expect(notificationTarget({ ...n, task: { status: "STARTED", deleted: true } }, "ADMIN")).toBeNull();
    expect(notificationTarget({ ...n, task: null }, "ADMIN")).toBeNull();
    expect(notificationTarget(n, "HR")).toBeNull(); // HR has no task list
    const inv = { kind: "PAYMENT_RECEIVED" as const, href: "/admin/invoices/i1", taskId: null, invoiceId: "i1" };
    expect(notificationTarget(inv, "ADMIN")).toBe("/admin/invoices/i1");
    const leave = { kind: "LEAVE_APPROVED" as const, href: "/requests/leave?leaveId=l1", taskId: null, invoiceId: null };
    expect(notificationTarget(leave, "ADMIN")).toBe("/admin/requests?tab=HR");
    expect(notificationTarget(leave, "HR")).toBe("/requests/leave?leaveId=l1");
    expect(notificationTarget({ ...leave, href: "/leave" }, "EXECUTIVE")).toBe("/leave");
    expect(notificationTarget({ kind: "GENERIC", href: "/", taskId: null, invoiceId: null }, "ADMIN")).toBeNull();
  });

  it("groups by Today / Yesterday / date in the company timezone", () => {
    const now = ist("2026-10-10T09:00:00");
    expect(dayLabel(ist("2026-10-10T00:10:00"), now, TZ)).toBe("Today");
    expect(dayLabel(ist("2026-10-09T23:50:00"), now, TZ)).toBe("Yesterday");
    expect(dayLabel(ist("2026-10-07T12:00:00"), now, TZ)).toBe("7 Oct");
    expect(dayLabel(ist("2025-12-30T12:00:00"), now, TZ)).toBe("30 Dec 2025");
    const rows = ["2026-10-10T08:00:00", "2026-10-10T07:00:00", "2026-10-09T18:00:00", "2026-10-07T10:00:00"].map((s, i) => ({ id: i, createdAt: ist(s) }));
    expect(groupByDay(rows, now, TZ).map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
      ["Today", [0, 1]],
      ["Yesterday", [2]],
      ["7 Oct", [3]],
    ]);
  });
});

describe("notification phrases", () => {
  it("start: on time vs n min late (minute precision)", () => {
    const at = ist("2026-10-10T10:00:00");
    expect(startPhrase("Arjun Mehta", at, ist("2026-10-10T09:58:00"))).toEqual({ late: false, text: "Arjun started it on time" });
    expect(startPhrase("Arjun", at, ist("2026-10-10T10:00:59"))).toEqual({ late: false, text: "Arjun started it on time" });
    expect(startPhrase("Arjun", at, ist("2026-10-10T10:05:00"))).toEqual({ late: true, text: "Arjun started it 5 min late" });
    expect(startPhrase("Arjun", at, ist("2026-10-10T11:20:00")).text).toBe("Arjun started it 1 h 20 min late");
    expect(startPhrase(null, null, at)).toEqual({ late: false, text: "Someone started it on time" });
    expect(fmtSpan(120)).toBe("2 h");
  });

  it("not started / past end / completed", () => {
    const now = ist("2026-10-10T15:30:00");
    expect(notStartedPhrase(ist("2026-10-10T10:00:00"), now, TZ)).toBe("Not started · was due at 10:00am");
    expect(notStartedPhrase(ist("2026-10-09T10:00:00"), now, TZ)).toBe("Not started · was due at 9 Oct, 10:00am");
    expect(pastEndPhrase(ist("2026-10-10T15:00:00"), now, TZ)).toBe("Still not finished · was due to end at 3:00pm");
    const end = ist("2026-10-10T15:00:00");
    expect(completedPhrase(end, ist("2026-10-10T14:48:00"))).toBe("Completed · 12 min early");
    expect(completedPhrase(end, ist("2026-10-10T15:05:00"))).toBe("Completed · 5 min late");
    expect(completedPhrase(end, ist("2026-10-10T15:00:30"))).toBe("Completed on time");
    expect(completedPhrase(null, end)).toBe("Completed");
  });

  it("leave days", () => {
    expect(leaveDays("2026-10-17", "2026-10-17")).toBe("17 Oct");
    expect(leaveDays("2026-10-17", "2026-10-18")).toBe("17–18 Oct");
    expect(leaveDays("2026-10-30", "2026-11-02")).toBe("30 Oct – 2 Nov");
  });
});

describe("dashboard ?task= deep link", () => {
  it("plans flash + open, open only (filtered out) or 'missing'", () => {
    const known = new Set(["a", "b"]);
    const shown = new Set(["a"]);
    expect(planDeepLink(null, known, shown)).toBeNull();
    expect(planDeepLink("a", known, shown)).toEqual({ kind: "open", flash: true });
    expect(planDeepLink("b", known, shown)).toEqual({ kind: "open", flash: false });
    expect(planDeepLink("zz", known, shown)).toEqual({ kind: "missing" });
  });

  it("strips only the deep-link params", () => {
    expect(strippedDashboardUrl("/dashboard", "?task=a&completed=1")).toBe("/dashboard");
    expect(strippedDashboardUrl("/dashboard", "?task=a&edit=1&add=WORK")).toBe("/dashboard?add=WORK");
    expect(strippedDashboardUrl("/dashboard", "")).toBe("/dashboard");
  });
});
