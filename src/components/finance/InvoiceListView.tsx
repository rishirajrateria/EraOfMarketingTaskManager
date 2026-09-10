"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InvoiceStatus } from "@prisma/client";
import { Pill } from "@/components/ui/Pill";
import { Sheet } from "@/components/ui/Sheet";
import { btnPrimary } from "@/components/ui/Field";
import { formatINR } from "@/server/finance/money";
import type { InvoiceRow } from "@/server/finance/queries";
import { InvoiceForm } from "@/components/finance/InvoiceForm";
import { STATUS_LABEL, STATUS_TONE, fmtDay } from "@/components/finance/finance-ui";

const STATUSES: InvoiceStatus[] = ["DRAFT", "SCHEDULED", "SENT", "PARTIALLY_PAID", "OVERDUE", "PAID"];
type ClientOpt = { id: string; name: string; email: string | null };

/** Payment Creator list (SPEC §11.3) with status filter and the "New invoice" sheet. */
export function InvoiceListView({ rows, status, clients, defaultGst, defaultTerms, canWrite, tz }: { rows: InvoiceRow[]; status: InvoiceStatus | null; clients: ClientOpt[]; defaultGst: number; defaultTerms: string; canWrite: boolean; tz: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const outstanding = rows.reduce((s, r) => s + (r.status === "DRAFT" || r.status === "SCHEDULED" ? 0 : r.balance), 0);
  return (
    <div className="flex flex-1 flex-col">
      <div className="bg-brand-blue px-4 pb-3 pt-3 text-white">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[11px] uppercase opacity-80">Outstanding</div>
            <div className="text-lg font-bold">{formatINR(outstanding)}</div>
          </div>
          <div className="text-xs opacity-80">{rows.length} invoices</div>
        </div>
        <div className="scrollbar-none mt-2 flex gap-2 overflow-x-auto">
          <Pill active={!status} onClick={() => router.push("/admin/invoices")}>All</Pill>
          {STATUSES.map((s) => (
            <Pill key={s} active={status === s} onClick={() => router.push(`/admin/invoices?status=${s}`)}>{STATUS_LABEL[s]}</Pill>
          ))}
        </div>
      </div>
      {canWrite ? (
        <div className="px-4 py-2">
          <button type="button" className={btnPrimary} onClick={() => setOpen(true)} disabled={clients.length === 0}>+ New invoice</button>
          {clients.length === 0 ? <span className="ml-2 text-xs text-gray-500">Add a client first.</span> : null}
        </div>
      ) : null}
      <ul className="divide-y bg-white">
        {rows.length === 0 ? <li className="px-4 py-8 text-center text-sm text-gray-500">No invoices yet.</li> : null}
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/admin/invoices/${r.id}`} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{r.number}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_TONE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                  {r.kind === "RECURRING" ? <span title="Recurring">🔁</span> : null}
                  {r.paymentMode === "ADVANCE" ? <span className="text-[10px] text-gray-500">advance</span> : null}
                </div>
                <div className="truncate text-xs text-gray-500">
                  {r.clientName} · {r.status === "SCHEDULED" ? `sends ${fmtDay(r.sendAt, tz)}` : r.dueDate ? `due ${fmtDay(r.dueDate, tz)}` : fmtDay(r.createdAt, tz)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold">{formatINR(r.total)}</div>
                {r.received > 0 ? <div className="text-[11px] text-gray-500">bal {formatINR(r.balance)}</div> : null}
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <Sheet open={open} onClose={() => setOpen(false)} title="New invoice" full>
        {open ? <InvoiceForm clients={clients} defaultGst={defaultGst} defaultTerms={defaultTerms} onDone={() => setOpen(false)} /> : null}
      </Sheet>
    </div>
  );
}
