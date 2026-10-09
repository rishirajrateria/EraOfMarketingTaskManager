/** Tabs + filters of the invoice list (plain module: usable from the server page and the client view). */
import type { InvoiceRow } from "@/server/finance/queries";

export const INVOICE_TABS = [
  { key: "all", label: "All" },
  { key: "awaiting", label: "Awaiting approval" },
  { key: "sent", label: "Sent" },
  { key: "partial", label: "Partially paid" },
  { key: "paid", label: "Paid" },
  { key: "overdue", label: "Overdue" },
  { key: "proforma", label: "Proforma" },
  { key: "credit", label: "Credit notes" },
] as const;
export type InvoiceTab = (typeof INVOICE_TABS)[number]["key"];

const BILLED = new Set(["TAX_INVOICE", "EXPORT_INVOICE"]);
const OPEN = new Set(["SENT", "PARTIALLY_PAID", "OVERDUE"]);

export function filterRows(rows: InvoiceRow[], tab: InvoiceTab): InvoiceRow[] {
  switch (tab) {
    case "awaiting": return rows.filter((r) => r.status === "AWAITING_APPROVAL" || r.status === "DRAFT");
    case "sent": return rows.filter((r) => r.status === "SENT");
    case "partial": return rows.filter((r) => r.status === "PARTIALLY_PAID");
    case "paid": return rows.filter((r) => r.status === "PAID");
    case "overdue": return rows.filter((r) => r.status === "OVERDUE");
    case "proforma": return rows.filter((r) => r.docType === "PROFORMA");
    case "credit": return rows.filter((r) => r.docType === "CREDIT_NOTE");
    default: return rows;
  }
}

export function planChip(r: Pick<InvoiceRow, "plan" | "partSeq">): string | null {
  if (r.plan === "RECURRING") return "Recurring";
  if (r.plan === "PART") return r.partSeq ? `Part ${r.partSeq}` : "Part";
  return null;
}


/** Header tiles: outstanding + overdue balances of open billed invoices, documents awaiting approval. */
export function listTiles(rows: InvoiceRow[], now = Date.now()) {
  const open = rows.filter((r) => BILLED.has(r.docType) && OPEN.has(r.status));
  return {
    outstanding: open.reduce((s, r) => s + r.balance, 0),
    overdue: open.filter((r) => r.status === "OVERDUE" || (r.dueDate && new Date(r.dueDate).getTime() < now)).reduce((s, r) => s + r.balance, 0),
    awaiting: rows.filter((r) => r.status === "AWAITING_APPROVAL").length,
  };
}
