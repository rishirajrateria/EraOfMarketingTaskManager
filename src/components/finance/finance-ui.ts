/** Client-safe helpers shared by finance components (no server imports). */
import type { BalanceMode, InvoiceStatus } from "@prisma/client";

/** How the balance invoice of an ADVANCE invoice is raised (create form radio + detail page). */
export const BALANCE_MODE_OPTIONS: { value: BalanceMode; label: string }[] = [
  { value: "DATE", label: "On a date" },
  { value: "MANUAL", label: "Manually" },
  { value: "AUTO", label: "Automatically when the client's tasks are complete (ask me before sending)" },
];

export const BALANCE_MODE_LABEL: Record<BalanceMode, string> = {
  DATE: "on a date",
  MANUAL: "manually",
  AUTO: "automatically when the client's tasks are complete",
};

export const STATUS_TONE: Record<InvoiceStatus, string> = {
  DRAFT: "glass-chip text-gray-800",
  AWAITING_APPROVAL: "border border-white/60 bg-amber-100/70 text-amber-900 backdrop-blur-sm",
  CANCELLED: "glass-chip text-gray-500 line-through",
  SCHEDULED: "border border-white/60 bg-blue-100/70 text-blue-800 backdrop-blur-sm",
  SENT: "border border-white/60 bg-indigo-100/70 text-indigo-800 backdrop-blur-sm",
  PARTIALLY_PAID: "border border-white/60 bg-amber-100/70 text-amber-800 backdrop-blur-sm",
  PAID: "border border-white/60 bg-green-100/70 text-green-800 backdrop-blur-sm",
  OVERDUE: "border border-white/60 bg-red-100/70 text-red-800 backdrop-blur-sm",
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

export const inputSm = "w-full rounded-lg border border-white/70 bg-white/60 px-2 py-1.5 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,.8)] backdrop-blur-md focus:border-brand-blue/60 focus:bg-white/80 focus:outline-none";
