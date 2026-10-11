"use client";
import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Field, btnPrimary, inputCls } from "@/components/ui/Field";
import { formatINR } from "@/server/finance/money";
import { mergeRemainingParts, updatePartSchedule } from "@/server/finance/invoices";
import type { InvoiceDetail } from "@/server/finance/queries";
import { dateKeyLocal, isoToDateKey } from "@/components/finance/finance-ui";
import { partsSummary, type PartRow } from "@/components/finance/invoice-form-helpers";
import { PartsEditor } from "@/components/finance/wizard/PartsEditor";
import { useAction } from "@/components/finance/useAction";

type Plan = NonNullable<InvoiceDetail["planRef"]>;

const pendingOf = (plan: Plan) => plan.parts.filter((p) => p.status === "PENDING");
const remainingOf = (plan: Plan) => pendingOf(plan).reduce((s, p) => s + p.amount, 0);

/** "Edit schedule": re-plan the PENDING parts; they must still add up to the remaining amount (percent = share of the plan total). */
export function EditScheduleSheet({ plan, open, onClose }: { plan: Plan; open: boolean; onClose: () => void }) {
  const { pending, run } = useAction();
  const remaining = remainingOf(plan);
  const firstSeq = Math.max(0, ...plan.parts.map((p) => p.seq)) + 1;
  const [parts, setParts] = useState<PartRow[]>(() => pendingOf(plan).map((p) => ({ kind: p.kind as PartRow["kind"], value: String(p.value), dueDate: isoToDateKey(p.dueDate), description: p.description })));
  const summary = partsSummary(parts, remaining, plan.totalAmount);
  const save = () =>
    run(
      () => updatePartSchedule(plan.id, parts.map((p) => ({ kind: p.kind, value: Number(p.value) || 0, dueDate: p.dueDate, description: p.description }))),
      () => {
        onClose();
        return "Schedule updated";
      },
    );
  return (
    <Sheet open={open} onClose={onClose} title="Edit schedule">
      <div className="space-y-3 px-4 py-4">
        <p className="text-xs text-gray-600">
          Issued and paid parts stay as they are. The pending parts below must add up to <b>{formatINR(remaining)}</b> (taxable); % values are a share of the plan total {formatINR(plan.totalAmount)}.
        </p>
        <PartsEditor parts={parts} total={remaining} percentBase={plan.totalAmount} onChange={setParts} firstSeq={firstSeq} label="Pending parts" />
        <button type="button" className={`${btnPrimary} w-full`} disabled={pending || !summary.valid} onClick={save}>{pending ? "Saving…" : "Save schedule"}</button>
      </div>
    </Sheet>
  );
}

/** "Merge remaining into one": all PENDING parts become one part with a single due date (issued as AWAITING_APPROVAL). */
export function MergePartsSheet({ plan, open, onClose }: { plan: Plan; open: boolean; onClose: () => void }) {
  const { pending, run, router } = useAction();
  const [dueDate, setDueDate] = useState(dateKeyLocal());
  const [description, setDescription] = useState("");
  const pendingParts = pendingOf(plan);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(
      () => mergeRemainingParts(plan.id, { dueDate, description: description || null }),
      (d) => {
        onClose();
        router.push(`/admin/invoices/${d.id}`);
        return `Merged into one part — awaiting approval`;
      },
    );
  };
  return (
    <Sheet open={open} onClose={onClose} title="Merge remaining parts">
      <form onSubmit={submit} className="space-y-3 px-4 py-4">
        <p className="text-sm text-gray-700">
          Parts {pendingParts.map((p) => p.seq).join(", ")} ({formatINR(remainingOf(plan))} taxable) become one invoice.
        </p>
        <Field label="Due date">
          <input type="date" required value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Description" hint="optional — printed on the invoice">
          <input value={description} onChange={(e) => setDescription(e.target.value)} className={inputCls} placeholder={`Remaining balance (parts ${pendingParts.map((p) => p.seq).join(", ")})`} />
        </Field>
        <button type="submit" className={`${btnPrimary} w-full`} disabled={pending}>{pending ? "Merging…" : "Merge & create invoice"}</button>
      </form>
    </Sheet>
  );
}
