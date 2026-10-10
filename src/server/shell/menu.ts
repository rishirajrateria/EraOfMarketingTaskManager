"use server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { getSettings } from "@/lib/settings";
import { dateKey, zonedStartOfDay } from "@/lib/time";
import { SETTLEMENT_INCLUDE, settleInvoice } from "@/server/finance/settlement";
import { wrap, type ActionResult } from "@/lib/action-result";
import type { Role } from "@prisma/client";
import { toDbDate } from "@/server/inventory/compute";
import { APPROVED_LEAVE } from "@/server/leave/queries";

/** Live numbers shown on the Admin menu rows (ADR 0011). Cheap counts only; read when the menu opens. */
export type MenuCounts = {
  invoicesToApprove: number;
  outstanding: number;
  /** Client invoices past their due date with money still owed (ADR 0013 hub "Needs you"). */
  invoicesOverdue: number;
  billsOverdue: number;
  billsDueWeek: number;
  gstToClaimMonth: number;
  clients: number;
  /** ADR 0014: active clients whose Drive kit exists. */
  clientsWithKit: number;
  credentials: number;
  executives: number;
  teams: string[];
  workTypes: number;
  requestsOpen: number;
  unread: number;
  company: string;
  /** ADR 0016 HR dashboard row: today's attendance of Team Leaders + Executives (approved leave counts as on leave). */
  attendanceMarkedToday: boolean;
  presentToday: number;
  onLeaveToday: number;
  /** ADR 0016 Task dashboard row: open tasks and work tasks late to start (the red cards). */
  tasksOpen: number;
  tasksLate: number;
};

const DAY = 86_400_000;

export async function menuCounts(): Promise<ActionResult<MenuCounts>> {
  return wrap(async () => {
    const user = await requireUser();
    if (user.role !== "ADMIN") throw new Error("Admin only");
    const settings = await getSettings();
    const tz = settings.timezone;
    const now = new Date();
    const today = zonedStartOfDay(now, tz);
    const monthStart = zonedStartOfDay(new Date(`${dateKey(now, tz).slice(0, 7)}-01T12:00:00Z`), tz);
    const todayDb = toDbDate(dateKey(now, tz));
    const staff = { active: true, role: { in: ["TEAM_LEADER", "EXECUTIVE"] as Role[] } };
    const [toApprove, open, overdue, dueWeek, gst, clients, kits, credentials, executives, teams, workTypes, requests, unread, attToday, leaveToday, tasksOpen, tasksLate] = await Promise.all([
      prisma.invoice.count({ where: { status: "AWAITING_APPROVAL" } }),
      prisma.invoice.findMany({
        where: { status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] }, docType: { in: ["TAX_INVOICE", "EXPORT_INVOICE"] } },
        select: { total: true, status: true, dueDate: true, ...SETTLEMENT_INCLUDE },
      }),
      prisma.expenseOccurrence.count({ where: { status: "DUE", dueDate: { lt: today } } }),
      prisma.expenseOccurrence.count({ where: { status: "DUE", dueDate: { gte: today, lt: new Date(today.getTime() + 8 * DAY) } } }),
      prisma.expenseOccurrence.aggregate({ _sum: { gstAmount: true }, where: { status: "PAID", itcClaimable: true, paidAt: { gte: monthStart } } }),
      prisma.client.count({ where: { active: true } }),
      prisma.client.count({ where: { active: true, kitFolderId: { not: null }, kitSheetId: { not: null } } }),
      prisma.clientVaultItem.count({ where: { kind: "CREDENTIAL" } }),
      prisma.user.count({ where: { role: "EXECUTIVE", active: true } }),
      prisma.team.findMany({ where: { active: true }, select: { name: true }, orderBy: { name: "asc" } }),
      prisma.workType.count({ where: { active: true } }),
      prisma.request.count({ where: { status: "OPEN", targetRole: "ADMIN" } }),
      prisma.notification.count({ where: { userId: user.id, readAt: null } }),
      prisma.attendance.findMany({ where: { date: todayDb, user: staff }, select: { userId: true, status: true } }),
      prisma.leave.findMany({ where: { status: { in: APPROVED_LEAVE }, from: { lte: todayDb }, to: { gte: todayDb }, user: staff }, select: { userId: true } }),
      prisma.task.count({ where: { deletedAt: null, status: { not: "COMPLETED" } } }),
      // rowColour "red": a work task not started (and not paused / in doubt) whose scheduled start has passed
      prisma.task.count({ where: { deletedAt: null, type: "WORK", status: { in: ["DRAFT", "ASSIGNED"] }, doubtRaised: false, scheduledStart: { lt: now } } }),
    ]);
    const att = new Map(attToday.map((a) => [a.userId, a.status]));
    const onLeave = new Set([...attToday.filter((a) => a.status === "LEAVE").map((a) => a.userId), ...leaveToday.filter((l) => !att.has(l.userId)).map((l) => l.userId)]);
    const owed = open.map((i) => ({ i, balance: settleInvoice(i).balance })).filter((x) => x.balance > 0);
    return {
      invoicesToApprove: toApprove,
      outstanding: Math.round(owed.reduce((s, x) => s + x.balance, 0)),
      invoicesOverdue: owed.filter((x) => x.i.status === "OVERDUE" || (x.i.dueDate && x.i.dueDate < now)).length,
      billsOverdue: overdue,
      billsDueWeek: dueWeek,
      gstToClaimMonth: Math.round(Number(gst._sum.gstAmount ?? 0)),
      clients,
      clientsWithKit: kits,
      credentials,
      executives,
      teams: teams.map((t) => t.name),
      workTypes,
      requestsOpen: requests,
      unread,
      company: settings.companyName,
      attendanceMarkedToday: attToday.length > 0 || leaveToday.length > 0,
      presentToday: attToday.filter((a) => a.status === "PRESENT" || a.status === "HALF_DAY").length,
      onLeaveToday: onLeave.size,
      tasksOpen,
      tasksLate,
    };
  });
}
