"use server";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/rbac";
import { getSettings } from "@/lib/settings";
import { dateKey, zonedStartOfDay } from "@/lib/time";
import { SETTLEMENT_INCLUDE, settleInvoice } from "@/server/finance/settlement";
import { wrap, type ActionResult } from "@/lib/action-result";

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
  credentials: number;
  executives: number;
  teams: string[];
  workTypes: number;
  requestsOpen: number;
  unread: number;
  company: string;
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
    const [toApprove, open, overdue, dueWeek, gst, clients, credentials, executives, teams, workTypes, requests, unread] = await Promise.all([
      prisma.invoice.count({ where: { status: "AWAITING_APPROVAL" } }),
      prisma.invoice.findMany({
        where: { status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] }, docType: { in: ["TAX_INVOICE", "EXPORT_INVOICE"] } },
        select: { total: true, status: true, dueDate: true, ...SETTLEMENT_INCLUDE },
      }),
      prisma.expenseOccurrence.count({ where: { status: "DUE", dueDate: { lt: today } } }),
      prisma.expenseOccurrence.count({ where: { status: "DUE", dueDate: { gte: today, lt: new Date(today.getTime() + 8 * DAY) } } }),
      prisma.expenseOccurrence.aggregate({ _sum: { gstAmount: true }, where: { status: "PAID", itcClaimable: true, paidAt: { gte: monthStart } } }),
      prisma.client.count({ where: { active: true } }),
      prisma.clientVaultItem.count({ where: { kind: "CREDENTIAL" } }),
      prisma.user.count({ where: { role: "EXECUTIVE", active: true } }),
      prisma.team.findMany({ where: { active: true }, select: { name: true }, orderBy: { name: "asc" } }),
      prisma.workType.count({ where: { active: true } }),
      prisma.request.count({ where: { status: "OPEN", targetRole: "ADMIN" } }),
      prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    const owed = open.map((i) => ({ i, balance: settleInvoice(i).balance })).filter((x) => x.balance > 0);
    return {
      invoicesToApprove: toApprove,
      outstanding: Math.round(owed.reduce((s, x) => s + x.balance, 0)),
      invoicesOverdue: owed.filter((x) => x.i.status === "OVERDUE" || (x.i.dueDate && x.i.dueDate < now)).length,
      billsOverdue: overdue,
      billsDueWeek: dueWeek,
      gstToClaimMonth: Math.round(Number(gst._sum.gstAmount ?? 0)),
      clients,
      credentials,
      executives,
      teams: teams.map((t) => t.name),
      workTypes,
      requestsOpen: requests,
      unread,
      company: settings.companyName,
    };
  });
}
