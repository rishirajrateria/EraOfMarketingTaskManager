/** Client-safe helpers shared by finance components (no server imports). */
import type { InvoiceStatus } from "@prisma/client";

export type DocType = "TAX_INVOICE" | "EXPORT_INVOICE" | "PROFORMA" | "CREDIT_NOTE";
export type TaxMode = "CGST_SGST" | "IGST" | "EXPORT_LUT" | "NONE";
export type PlanKind = "ONE_TIME" | "RECURRING" | "PART";

const soft = (c: string) => `border border-white/60 backdrop-blur-sm ${c}`;

export const STATUS_TONE: Record<InvoiceStatus, string> = {
  DRAFT: "glass-chip text-gray-800",
  AWAITING_APPROVAL: soft("bg-amber-100/70 text-amber-900"),
  CANCELLED: "glass-chip text-gray-500 line-through",
  SCHEDULED: soft("bg-blue-100/70 text-blue-800"),
  SENT: soft("bg-indigo-100/70 text-indigo-800"),
  PARTIALLY_PAID: soft("bg-amber-100/70 text-amber-800"),
  PAID: soft("bg-green-100/70 text-green-800"),
  OVERDUE: soft("bg-red-100/70 text-red-800"),
};

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  DRAFT: "Draft",
  AWAITING_APPROVAL: "Awaiting approval",
  CANCELLED: "Cancelled",
  SCHEDULED: "Scheduled",
  SENT: "Sent",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
};

export const DOC_LABEL: Record<DocType, string> = {
  TAX_INVOICE: "Tax Invoice",
  EXPORT_INVOICE: "Export Invoice",
  PROFORMA: "Proforma",
  CREDIT_NOTE: "Credit note",
};

export const DOC_TONE: Record<DocType, string> = {
  TAX_INVOICE: soft("bg-sky-100/70 text-sky-900"),
  EXPORT_INVOICE: soft("bg-teal-100/70 text-teal-900"),
  PROFORMA: soft("bg-violet-100/70 text-violet-900"),
  CREDIT_NOTE: soft("bg-rose-100/70 text-rose-900"),
};

export const TAX_MODE_LABEL: Record<TaxMode, string> = {
  CGST_SGST: "CGST+SGST",
  IGST: "IGST",
  EXPORT_LUT: "0% under LUT",
  NONE: "No tax",
};

/** ADR 0007: currencies offered for clients outside India (export invoices print the code before the amount). */
export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD", "SAR", "QAR", "NZD"] as const;

export const PAYMENT_METHODS = ["CASH", "BANK", "UPI", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const METHOD_LABEL: Record<string, string> = { CASH: "Cash", BANK: "Bank", UPI: "UPI", OTHER: "Other" };

/** "Draft" for unnumbered documents. */
export function docNumber(number: string): string {
  return number.startsWith("DRAFT-") ? "Draft" : number;
}

export function fmtDay(iso: string | null | undefined, tz: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: tz });
}

export function fmtDayTime(iso: string | null | undefined, tz: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", timeZone: tz });
}

/** yyyy-MM-dd for <input type="date"> (local calendar day). */
export function dateKeyLocal(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDaysKey(days: number, from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return dateKeyLocal(d);
}

/** ISO → yyyy-MM-dd for date inputs. */
export function isoToDateKey(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}

/** Turn a server-action CSV string into a browser download. */
export function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function thisMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonthKey(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

export const inputSm = "w-full rounded-lg border border-white/70 bg-white/60 px-2 py-1.5 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,.8)] backdrop-blur-md focus:border-brand-blue/60 focus:bg-white/80 focus:outline-none";
export const chipCls = "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium";
export const segActive = "bg-gray-900/90 text-white backdrop-blur-md";
export const segIdle = "glass-chip text-gray-800";
