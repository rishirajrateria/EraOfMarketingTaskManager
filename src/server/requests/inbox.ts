import { getSettings } from "@/lib/settings";
import { dateKey } from "@/lib/time";
import { awaitingApproval, paymentsDashboard } from "@/server/finance/queries";
import { billsNeedingPayment } from "@/server/finance/hub-queries";
import { DOC_LABEL, docNumber } from "@/components/finance/finance-ui";
import { listInboxRequests, type RequestItem } from "@/server/requests/queries";
import { groupByArea } from "@/server/requests/areas";

/**
 * Finance items that need the owner (ADR 0016), from the same queries as the hub's "Needs you" (ADR 0013): invoices
 * awaiting approval (→ the approve sheet), client invoices overdue (→ the invoice) and vendor bills overdue or due within
 * 7 days (→ Mark paid; `late` only when overdue).
 */
export type FinanceNeed = { kind: "APPROVE" | "OVERDUE" | "BILL"; id: string; title: string; sub: string; amount: number; href: string; late: boolean; dateKey: string | null };

const dayKey = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayMonth = (key: string) => `${Number(key.slice(8, 10))} ${MONTHS[Number(key.slice(5, 7)) - 1]}`;
/** "3 days late": calendar days between the due day and today (yyyy-MM-dd keys in the company timezone), at least 1. */
export function lateText(dueKey: string | null, todayKey: string): string {
  if (!dueKey) return "overdue";
  const n = Math.max(1, Math.round((Date.parse(`${todayKey}T00:00:00Z`) - Date.parse(`${dueKey}T00:00:00Z`)) / DAY));
  return `${n} day${n === 1 ? "" : "s"} late`;
}

export async function financeNeeds(now = new Date()): Promise<FinanceNeed[]> {
  const [awaiting, dash, bills, settings] = await Promise.all([awaitingApproval(), paymentsDashboard({}, now), billsNeedingPayment(now), getSettings()]);
  const tz = settings.timezone;
  const today = dateKey(now, tz);
  return [
    ...awaiting.map((a): FinanceNeed => ({
      kind: "APPROVE",
      id: a.id,
      title: a.clientName,
      sub: `Approve & send ${(DOC_LABEL[a.docType as keyof typeof DOC_LABEL] ?? "invoice").toLowerCase()}`,
      amount: a.total,
      href: `/admin/invoices/${a.id}?approve=1`,
      late: false,
      dateKey: dayKey(a.createdAt),
    })),
    ...dash.overdue.flatMap((g) =>
      g.invoices.map((i): FinanceNeed => ({ kind: "OVERDUE", id: i.id, title: g.clientName, sub: `${docNumber(i.number)} · ${lateText(i.dueDate ? dateKey(new Date(i.dueDate), tz) : null, today)}`, amount: i.balance, href: `/admin/invoices/${i.id}`, late: true, dateKey: dayKey(i.dueDate) })),
    ),
    ...bills.map((b): FinanceNeed => ({
      kind: "BILL",
      id: b.occId,
      title: b.payee,
      sub: `Bill ${b.overdue ? lateText(b.dueKey, today) : `due ${dayMonth(b.dueKey)}`} · mark paid`,
      amount: b.amount,
      href: `/admin/expenses?tab=DUE&pay=${b.occId}`,
      late: b.overdue,
      dateKey: b.dueKey,
    })),
  ];
}

export type RequestInbox = { finance: FinanceNeed[]; work: RequestItem[]; hr: RequestItem[] };

export async function requestInbox(opts: { includeResolved?: boolean } = {}, now = new Date()): Promise<RequestInbox> {
  const [finance, rows] = await Promise.all([financeNeeds(now), listInboxRequests(opts)]);
  const g = groupByArea(rows);
  return { finance, work: g.WORK, hr: g.HR };
}
