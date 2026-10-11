/**
 * Client tracking link (prototype `PAGES.portal`): one public, unguessable page per client at `/c/<token>` — no login.
 * It shows ONLY what the client may see: their name, the progress of their work (titles, status words and due DAYS),
 * what we need from them, their kit's Drive folder, and issued invoices (upcoming / paid) with a PDF each. Never hours,
 * start / end times, staff names, internal notes, other clients, drafts or invoices awaiting approval.
 * Plain module (no "use server"): read by the public page and the token-scoped PDF route; unit-tested in tests/portal.
 */
import { randomBytes } from "crypto";
import type { Prisma, TaskStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { dateKey } from "@/lib/time";
import { rowColour, type RowColour } from "@/server/tasks/state";
import { hasKit, kitUrls } from "@/server/clients/kit-paths";
import { PAID_EPSILON, formatMoney } from "@/server/finance/money";
import { SETTLEMENT_INCLUDE, settleInvoice } from "@/server/finance/settlement";

/** 128-bit random token, lowercase hex. */
export const PORTAL_TOKEN_RE = /^[a-f0-9]{32}$/;
export const newPortalToken = () => randomBytes(16).toString("hex");

/** The client's token, made on first use (Admin opening the tracking link). */
export async function ensurePortalToken(clientId: string): Promise<string> {
  const c = await prisma.client.findUnique({ where: { id: clientId }, select: { portalToken: true } });
  if (!c) throw new Error("Client not found");
  if (c.portalToken) return c.portalToken;
  const token = newPortalToken();
  const res = await prisma.client.updateMany({ where: { id: clientId, portalToken: null }, data: { portalToken: token } });
  if (res.count) return token;
  return (await prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { portalToken: true } })).portalToken!;
}

/** The client a token opens (active clients only), or null. */
export async function clientForToken(token: string) {
  if (!PORTAL_TOKEN_RE.test(token)) return null;
  const c = await prisma.client.findUnique({ where: { portalToken: token } });
  return c && c.active ? c : null;
}

/**
 * Invoices the client has received: approved and sent (SENT / PARTIALLY_PAID / PAID / OVERDUE) tax, export and
 * proforma invoices — never drafts, invoices awaiting approval, scheduled-but-unsent ones, cancelled ones, credit notes
 * or a proforma already converted into a tax invoice.
 */
export function issuedInvoiceWhere(clientId: string): Prisma.InvoiceWhereInput {
  return {
    clientId,
    approvedAt: { not: null },
    status: { in: ["SENT", "PARTIALLY_PAID", "PAID", "OVERDUE"] },
    docType: { in: ["TAX_INVOICE", "EXPORT_INVOICE", "PROFORMA"] },
    convertedTo: { is: null },
  };
}

export type PortalTask = { title: string; status: string; tone: RowColour; /** "Due" / "Needed by" DAY (yyyy-MM-dd), never a time. */ due: string | null };
export type PortalMoney = { id: string; label: string; amount: string; /** yyyy-MM-dd */ date: string | null; overdue: boolean };
export type PortalData = {
  clientName: string;
  progress: { done: number; total: number };
  asks: PortalTask[];
  work: PortalTask[];
  finished: PortalTask[];
  driveUrl: string | null;
  upcoming: PortalMoney[];
  paid: PortalMoney[];
  company: { name: string; email: string; phone: string };
};

type StatusInput = { status: TaskStatus; doubtRaised: boolean; type: "WORK" | "MEETING"; scheduledStart: Date | null; forClient: boolean };

/**
 * The status word, in the dashboard's colour family: Done (faded) · Query raised (purple) · On hold (yellow) · In
 * progress (green) · Not started / Waiting for you (white) — "· overdue" and red once the day / start has passed.
 */
export function portalStatus(t: StatusInput, now = new Date()): { status: string; tone: RowColour } {
  const tone = rowColour({ status: t.status, doubtRaised: t.doubtRaised, type: t.type, scheduledStart: t.scheduledStart }, now);
  const wait = t.forClient ? "Waiting for you" : "Not started";
  const status =
    t.status === "COMPLETED" ? "Done" : t.doubtRaised ? "Query raised" : t.status === "PAUSED" ? "On hold" : tone === "green" ? "In progress" : tone === "red" ? `${wait} · overdue` : wait;
  return { status, tone };
}

const DOC_LABEL = { TAX_INVOICE: "Invoice", EXPORT_INVOICE: "Invoice", PROFORMA: "Proforma invoice", CREDIT_NOTE: "Credit note" } as const;
const MAX_DONE = 30;

/** Everything the tracking page shows for `token`, or null for an unknown / inactive client. */
export async function portalData(token: string, now = new Date()): Promise<PortalData | null> {
  const client = await clientForToken(token);
  if (!client) return null;
  const s = await getSettings();
  const tz = s.timezone;
  const [tasks, invoices] = await Promise.all([
    prisma.task.findMany({
      where: { clientId: client.id, deletedAt: null, type: "WORK" },
      select: { title: true, status: true, doubtRaised: true, type: true, scheduledStart: true, scheduledEnd: true, deadlineOnly: true, forClient: true },
      orderBy: [{ scheduledEnd: "asc" }, { createdAt: "asc" }],
      take: 500,
    }),
    prisma.invoice.findMany({
      where: issuedInvoiceWhere(client.id),
      select: { id: true, number: true, docType: true, status: true, total: true, currency: true, dueDate: true, approvedAt: true, updatedAt: true, ...SETTLEMENT_INCLUDE, payments: { select: { amount: true, tdsAmount: true, receivedAt: true } } },
    }),
  ]);
  // "Due" = the scheduled end day, or the deadline / "needed by" day — a day only, never a time.
  const shape = (t: (typeof tasks)[number]): PortalTask => {
    const due = t.deadlineOnly ? t.scheduledStart : t.scheduledEnd;
    return { title: t.title, ...portalStatus(t, now), due: due ? dateKey(due, tz) : null };
  };
  const byDue = (a: PortalTask, b: PortalTask) => (a.due ?? "9999").localeCompare(b.due ?? "9999");
  const asks = tasks.filter((t) => t.forClient);
  const work = tasks.filter((t) => !t.forClient);
  const done = work.filter((t) => t.status === "COMPLETED");

  const today = dateKey(now, tz);
  const label = (i: (typeof invoices)[number]) => `${DOC_LABEL[i.docType]} ${i.number}`;
  const upcoming = invoices
    .map((i) => ({ i, balance: settleInvoice(i).balance }))
    .filter(({ i, balance }) => i.status !== "PAID" && balance > PAID_EPSILON)
    .map(({ i, balance }): PortalMoney => {
      const due = i.dueDate ? dateKey(i.dueDate, tz) : null;
      return { id: i.id, label: label(i), amount: formatMoney(balance, i.currency), date: due, overdue: !!due && due < today };
    })
    .sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
  const paid = invoices
    .filter((i) => i.status === "PAID")
    .map((i) => {
      const last = i.payments.reduce<Date | null>((m, p) => (!m || p.receivedAt > m ? p.receivedAt : m), null) ?? i.updatedAt;
      return { at: last, row: { id: i.id, label: label(i), amount: formatMoney(i.total.toNumber(), i.currency), date: dateKey(last, tz), overdue: false } as PortalMoney };
    })
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 5)
    .map((x) => x.row);

  return {
    clientName: client.businessName?.trim() || client.name,
    progress: { done: done.length, total: work.length },
    asks: asks.map(shape).sort(byDue),
    work: work.filter((t) => t.status !== "COMPLETED").map(shape).sort(byDue),
    finished: done.map(shape).sort((a, b) => byDue(b, a)).slice(0, MAX_DONE),
    driveUrl: hasKit(client) ? (kitUrls(client)?.folder ?? null) : null,
    upcoming,
    paid,
    company: { name: s.companyName, email: s.email, phone: s.phone },
  };
}

/** The invoice behind a tracking page's PDF button: only that client's issued invoices; anything else is null. */
export async function portalInvoiceId(token: string, invoiceId: string): Promise<string | null> {
  const client = await clientForToken(token);
  if (!client || !/^[a-z0-9]{1,40}$/i.test(invoiceId)) return null;
  const inv = await prisma.invoice.findFirst({ where: { id: invoiceId, ...issuedInvoiceWhere(client.id) }, select: { id: true } });
  return inv?.id ?? null;
}

/** Email / WhatsApp texts for sending the link. */
export function portalMessage(opts: { channel: "EMAIL" | "WHATSAPP"; greetName: string; company: string; url: string }): string {
  if (opts.channel === "WHATSAPP") {
    return `Hi ${opts.greetName}, here is your ${opts.company} tracking link — your work's progress, what we need from you, your Drive folder and payments: ${opts.url}`;
  }
  return [
    `Hi ${opts.greetName},`,
    "",
    `You can follow your work with ${opts.company} on this page — the progress of each task, anything we need from you, your Drive folder, upcoming and past payments, and your invoices to download:`,
    "",
    opts.url,
    "",
    "No login is needed. Please keep the link to yourself — anyone with it can see this page.",
    "",
    "Regards,",
    opts.company,
  ].join("\n");
}
