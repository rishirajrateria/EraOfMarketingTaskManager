"use client";
import { useState } from "react";
import { BarChip, BottomZone, ZonePill, ZoneRow } from "@/components/ui/BottomZone";
import { convertProforma, deleteInvoice, resumeWork, sendReminder, stopRecurrence } from "@/server/finance/invoices";
import type { InvoiceDetail } from "@/server/finance/queries";
import { ApproveSheet, type Templates } from "@/components/finance/ApproveSheet";
import { PaymentSheet } from "@/components/finance/PaymentSheet";
import { CreditNoteSheet, HoldWorkSheet, PushForwardSheet } from "@/components/finance/InvoiceSheets";
import { useAction } from "@/components/finance/useAction";
import { fmtDayTime } from "@/components/finance/finance-ui";

type SheetKind = "approve" | "resend" | "pay" | "push" | "hold" | "credit" | null;

/** Which actions make sense for this document right now (ADR 0005 status machine). */
export function availableActions(inv: InvoiceDetail) {
  const billed = inv.docType === "TAX_INVOICE" || inv.docType === "EXPORT_INVOICE";
  const unapproved = !inv.approvedAt && (inv.status === "DRAFT" || inv.status === "AWAITING_APPROVAL");
  const open = inv.status === "SENT" || inv.status === "PARTIALLY_PAID" || inv.status === "OVERDUE";
  const settled = inv.status === "PAID" || inv.status === "CANCELLED";
  return {
    approve: unapproved || inv.status === "AWAITING_APPROVAL",
    resend: open,
    pay: billed && open,
    push: !settled,
    remind: open && billed,
    hold: billed && !settled && !!inv.approvedAt && !inv.client.workOnHold,
    resume: inv.client.workOnHold,
    credit: billed && !!inv.approvedAt && inv.status !== "CANCELLED",
    convert: inv.docType === "PROFORMA" && !inv.convertedTo && inv.status !== "CANCELLED",
    stop: !!inv.schedule && !inv.schedule.stopped,
    delete: unapproved,
  };
}

/** Bottom action zone of the invoice detail page: primary actions in the white part, the rest as green pills. */
export function InvoiceActions({ inv, tz, templates, tdsPercent, openTasks }: { inv: InvoiceDetail; tz: string; templates: Templates; tdsPercent: number | null; openTasks: number }) {
  const { pending, run, router } = useAction();
  const [sheet, setSheet] = useState<SheetKind>(null);
  const a = availableActions(inv);
  const close = () => setSheet(null);

  const onDelete = () => {
    if (!confirm("Delete this unapproved document?")) return;
    run(
      () => deleteInvoice(inv.id),
      () => {
        router.push("/admin/invoices");
        return "Deleted";
      },
      { refresh: false },
    );
  };

  const pills: { key: string; label: string; onClick: () => void; danger?: boolean }[] = [];
  if (a.push) pills.push({ key: "push", label: inv.remindAt ? "Reminder set" : "Push forward", onClick: () => setSheet("push") });
  if (a.remind) pills.push({ key: "remind", label: inv.reminderSentAt ? `Remind again (${inv.reminderCount})` : "Send reminder", onClick: () => run(() => sendReminder(inv.id), (d) => `Reminder ${d.reminderCount} sent${d.emailed ? " by email" : ""}${d.whatsapped ? " on WhatsApp" : ""}`) });
  if (a.hold) pills.push({ key: "hold", label: "Hold work", onClick: () => setSheet("hold") });
  if (a.resume) pills.push({ key: "resume", label: "Resume work", onClick: () => run(() => resumeWork(inv.clientId), (d) => `Work resumed · ${d.resumed} task${d.resumed === 1 ? "" : "s"}`) });
  if (a.credit) pills.push({ key: "credit", label: "Credit note", onClick: () => setSheet("credit") });
  if (a.convert) pills.push({ key: "convert", label: "Convert to invoice", onClick: () => run(() => convertProforma(inv.id), (d) => { router.push(`/admin/invoices/${d.id}`); return "Tax invoice created — awaiting approval"; }) });
  if (a.stop) pills.push({ key: "stop", label: "Stop recurrence", onClick: () => { if (confirm("Stop creating future occurrences?")) run(() => stopRecurrence(inv.id), () => "Recurrence stopped"); } });
  if (a.delete) pills.push({ key: "delete", label: "Delete", onClick: onDelete, danger: true });

  const caption = a.remind && inv.reminderSentAt ? `Last reminder ${fmtDayTime(inv.reminderSentAt, tz)}` : inv.remindAt ? `Reminder on ${fmtDayTime(inv.remindAt, tz)}` : null;

  return (
    <>
      <BottomZone
        rows={
          pills.length ? (
            <ZoneRow label="More actions">
              {pills.map((p) => (
                <ZonePill key={p.key} onClick={p.onClick} className={`${p.danger ? "text-red-800" : ""} ${pending ? "opacity-60" : ""}`}>{p.label}</ZonePill>
              ))}
            </ZoneRow>
          ) : undefined
        }
        left={caption ? <span className="truncate text-[11px] text-white/90">{caption}</span> : <span className="text-[11px] text-white/80">{inv.clientName}</span>}
        right={
          <>
            {a.approve ? <BarChip onClick={() => setSheet("approve")} label="Approve & send" className="font-semibold">Approve & send</BarChip> : null}
            {a.pay ? <BarChip onClick={() => setSheet("pay")} label="Record payment" className="font-semibold">Record payment</BarChip> : null}
            {a.resend ? <BarChip onClick={() => setSheet("resend")} label="Resend">Resend</BarChip> : null}
            {!a.approve && !a.pay && !a.resend ? <span className="text-[11px] text-gray-500">{inv.status === "PAID" ? "Paid" : inv.status === "CANCELLED" ? "Cancelled" : "No actions"}</span> : null}
          </>
        }
      />
      {/* The mode is fixed when the sheet opens so the refresh after approval does not retitle it. */}
      {sheet === "approve" || sheet === "resend" ? <ApproveSheet inv={inv} tz={tz} templates={templates} open onClose={close} resend={sheet === "resend"} /> : null}
      {sheet === "pay" ? <PaymentSheet inv={inv} tdsPercent={tdsPercent} open onClose={close} /> : null}
      {sheet === "push" ? <PushForwardSheet inv={inv} open onClose={close} /> : null}
      {sheet === "hold" ? <HoldWorkSheet inv={inv} openTasks={openTasks} open onClose={close} /> : null}
      {sheet === "credit" ? <CreditNoteSheet inv={inv} open onClose={close} /> : null}
    </>
  );
}
