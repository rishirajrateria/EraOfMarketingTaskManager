/** Client-safe helpers shared by finance components (no server imports). */
import type { InvoiceStatus } from "@prisma/client";

export const STATUS_TONE: Record<InvoiceStatus, string> = {
  DRAFT: "bg-gray-200 text-gray-800",
  SCHEDULED: "bg-blue-100 text-blue-800",
  SENT: "bg-indigo-100 text-indigo-800",
  PARTIALLY_PAID: "bg-amber-100 text-amber-800",
  PAID: "bg-green-100 text-green-800",
  OVERDUE: "bg-red-100 text-red-800",
};

export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  SENT: "Sent",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  OVERDUE: "Overdue",
};

export function fmtDay(iso: string | null | undefined, tz: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: tz });
}

export function fmtDayTime(iso: string | null | undefined, tz: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", timeZone: tz });
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

export const inputSm = "w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-brand-blue focus:outline-none";
