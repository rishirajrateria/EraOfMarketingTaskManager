"use client";
import Link from "next/link";
import { BellRing, FileText, Receipt } from "lucide-react";
import type { RequestItem } from "@/server/requests/queries";
import type { FinanceNeed } from "@/server/requests/inbox";
import { REVIEW_FIELD_NAME, isReviewField } from "@/server/tasks/review-fields";
import { formatINRWhole } from "@/server/finance/money";
import { clsx } from "@/lib/clsx";
import { fmtDate, fmtDateTime } from "@/lib/time";

/** Leave dates are calendar days stored as UTC midnight: "17 Oct". */
const leaveDay = (iso: string) => fmtDate(new Date(iso), "UTC", "d MMM");

/** One row of the requests inbox (ADR 0016): a finance item (tap → act on it) or a work / HR request with its actions. */
export const REQUEST_LABEL: Record<string, string> = {
  FINISH: "Finish request",
  DOUBT: "Doubt",
  REVIEW: "Review request",
  TIME_CHANGE: "Time-change request",
  FIX_SELF_TASK: "Fix self-assigned task",
  LEAVE: "Leave request",
  APPROVED_CHANGE: "Change to approved leave",
};

const FIN_KIND = {
  APPROVE: { icon: FileText, tone: "bg-[linear-gradient(150deg,#f59e0b,#d97706)]", tag: "Approve & send" },
  OVERDUE: { icon: BellRing, tone: "bg-[linear-gradient(150deg,#f87171,#dc2626)]", tag: "Client overdue" },
  BILL: { icon: Receipt, tone: "bg-[linear-gradient(150deg,#a78bfa,#7c3aed)]", tag: "Bill overdue" },
} as const;

export function FinanceRow({ item }: { item: FinanceNeed }) {
  const k = FIN_KIND[item.kind];
  const Icon = k.icon;
  return (
    <li className="border-b border-line last:border-b-0">
      <Link href={item.href} className="flex items-center gap-3 px-3.5 py-3 active:bg-chip" aria-label={`${k.tag}: ${item.title}, ${formatINRWhole(item.amount)}. ${item.sub}`}>
        <span className={clsx("flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] text-white", k.tone)}>
          <Icon size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[14px] font-semibold">{item.title}</b>
          <small className={clsx("block truncate text-[12px]", item.late ? "text-red-600 dark:text-red-400" : "text-muted")}>{item.sub}</small>
        </span>
        <b className={clsx("shrink-0 text-[13.5px] tabular-nums", item.late && "text-red-600 dark:text-red-400")}>{formatINRWhole(item.amount)}</b>
      </Link>
    </li>
  );
}

export function RequestHead({ r, tz }: { r: RequestItem; tz: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="inline-flex h-[20px] min-w-0 items-center truncate rounded-full border border-hair bg-chip px-2 text-[10.5px] font-bold uppercase leading-[18px] tracking-[.04em] text-ink">
          {REQUEST_LABEL[r.type] ?? r.type}
          {r.field && isReviewField(r.field) ? ` · ${REVIEW_FIELD_NAME[r.field]}` : ""}
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-muted">{fmtDateTime(new Date(r.createdAt), tz)}</span>
      </div>
      {r.task ? (
        <Link href={`/dashboard?task=${r.task.id}`} className="mt-1 block truncate text-[14px] font-semibold">
          {r.task.title} <span className="font-normal text-muted">· {r.task.client}</span>
        </Link>
      ) : r.leave ? (
        <Link href={`/requests/leave?leaveId=${r.leave.id}`} className="mt-1 block text-[14px] font-semibold">
          {r.leave.userName} · {leaveDay(r.leave.from)}
          {r.leave.to.slice(0, 10) !== r.leave.from.slice(0, 10) ? ` → ${leaveDay(r.leave.to)}` : ""}
        </Link>
      ) : null}
      {r.note ? <div className="mt-0.5 text-[13px] text-ink">“{r.note}”</div> : null}
      <div className="mt-0.5 text-[11.5px] text-muted">
        from <b className="font-semibold text-ink">{r.raisedBy.name}</b>
        {r.status !== "OPEN" ? <span className="font-semibold uppercase"> · {r.status.toLowerCase()}</span> : null}
      </div>
    </div>
  );
}
