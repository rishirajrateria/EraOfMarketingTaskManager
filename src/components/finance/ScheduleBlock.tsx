"use client";
import { useState } from "react";
import Link from "next/link";
import { formatINR } from "@/server/finance/money";
import { describeMonthAnchor } from "@/server/finance/recurrence";
import { minutesToHHMM } from "@/lib/time";
import { issuePart } from "@/server/finance/invoices";
import type { InvoiceDetail } from "@/server/finance/queries";
import { Section } from "@/components/finance/InvoiceDetailSections";
import {
  EditScheduleSheet,
  MergePartsSheet,
} from "@/components/finance/PartScheduleSheet";
import { useAction } from "@/components/finance/useAction";
import {
  STATUS_LABEL,
  STATUS_TONE,
  chipCls,
  docNumber,
  fmtDay,
} from "@/components/finance/finance-ui";

const PART_TONE: Record<string, string> = {
  PENDING: "glass-chip text-gray-700",
  ISSUED:
    "border border-white/60 bg-indigo-100/70 text-indigo-800 backdrop-blur-sm",
  PAID: "border border-white/60 bg-green-100/70 text-green-800 backdrop-blur-sm",
  MERGED: "glass-chip text-gray-400 line-through",
  CANCELLED: "glass-chip text-gray-400 line-through",
};

/** Recurring info, or the part-payment schedule with per-part actions (issue now / edit / merge). */
export function ScheduleBlock({
  inv,
  tz,
  canWrite,
}: {
  inv: InvoiceDetail;
  tz: string;
  canWrite: boolean;
}) {
  const { pending, run, router } = useAction();
  const [sheet, setSheet] = useState<"edit" | "merge" | null>(null);
  if (inv.schedule) {
    const s = inv.schedule;
    const freq =
      s.frequency === "MONTHLY"
        ? `Monthly · ${describeMonthAnchor(s.monthAnchor, s.dayOfMonth)} at ${minutesToHHMM(s.notifyMinutes)}`
        : s.frequency === "WEEKLY"
          ? "Weekly"
          : s.frequency === "DAILY"
            ? "Daily"
            : `Every ${s.interval} days`;
    return (
      <Section title="Recurrence">
        <div className="text-sm">
          {freq}
          {s.stopped
            ? " · stopped"
            : s.nextRunAt
              ? ` · next ${fmtDay(s.nextRunAt, tz)}`
              : ""}
          {s.endDate ? ` · until ${fmtDay(s.endDate, tz)}` : " · infinite"}
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Each occurrence is created as awaiting approval; nothing is sent
          automatically.
        </p>
      </Section>
    );
  }
  const plan = inv.planRef;
  if (!plan) return null;
  const pendingParts = plan.parts.filter((p) => p.status === "PENDING");
  return (
    <>
      <Section title={`Payment plan · ${formatINR(plan.totalAmount)} taxable`}>
        <ul className="divide-y divide-white/60">
          {plan.parts.map((p) => (
            <li
              key={p.seq}
              className={`py-2 text-sm ${p.seq === inv.partSeq ? "font-medium" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span>Part {p.seq}</span>
                  <span className="text-gray-500">
                    {" "}
                    · {p.kind === "PERCENT" ? `${p.value}%` : "fixed"} · due{" "}
                    {fmtDay(p.dueDate, tz)}
                  </span>
                  {p.description ? (
                    <div className="truncate text-xs text-gray-500">
                      {p.description}
                    </div>
                  ) : null}
                </div>
                <div className="shrink-0 text-right">
                  <div>{formatINR(p.amount)}</div>
                  <span className={`${chipCls} ${PART_TONE[p.status] ?? ""}`}>
                    {p.status.toLowerCase()}
                  </span>
                </div>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                {p.invoice ? (
                  <Link
                    href={`/admin/invoices/${p.invoice.id}`}
                    className="text-brand-blue underline"
                  >
                    {p.invoice.id === inv.id
                      ? "this invoice"
                      : docNumber(p.invoice.number)}
                  </Link>
                ) : null}
                {p.invoice ? (
                  <span
                    className={`${chipCls} ${STATUS_TONE[p.invoice.status]}`}
                  >
                    {STATUS_LABEL[p.invoice.status]}
                  </span>
                ) : null}
                {canWrite && p.status === "PENDING" ? (
                  <button
                    type="button"
                    disabled={pending}
                    className="glass-chip rounded-full px-2.5 py-0.5 font-medium text-gray-800"
                    onClick={() =>
                      run(
                        () => issuePart(plan.id, p.seq),
                        (d) => {
                          router.push(`/admin/invoices/${d.id}`);
                          return `Part ${p.seq} issued — awaiting approval`;
                        },
                      )
                    }
                  >
                    Issue now
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        {canWrite && pendingParts.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className="glass-chip rounded-full px-3 py-1 text-xs font-medium text-gray-800"
              onClick={() => setSheet("edit")}
            >
              Edit schedule
            </button>
            <button
              type="button"
              className="glass-chip rounded-full px-3 py-1 text-xs font-medium text-gray-800"
              onClick={() => setSheet("merge")}
            >
              Merge remaining into one
            </button>
          </div>
        ) : null}
      </Section>
      {/* Sheets live outside the glass section: a backdrop-filter ancestor would clip the fixed overlay. */}
      {sheet === "edit" ? (
        <EditScheduleSheet plan={plan} open onClose={() => setSheet(null)} />
      ) : null}
      {sheet === "merge" ? (
        <MergePartsSheet plan={plan} open onClose={() => setSheet(null)} />
      ) : null}
    </>
  );
}
