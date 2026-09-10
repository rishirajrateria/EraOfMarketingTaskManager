"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pill } from "@/components/ui/Pill";
import { Sheet } from "@/components/ui/Sheet";
import { btnPrimary, btnSecondary } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { formatINR } from "@/server/finance/money";
import type { ExpenseRow } from "@/server/finance/queries";
import { deleteExpense, exportExpensesCsv, syncExpensesToSheet } from "@/server/finance/expenses";
import { ExpenseForm } from "@/components/finance/ExpenseForm";
import { downloadText, fmtDay } from "@/components/finance/finance-ui";

type Props = { rows: ExpenseRow[]; total: number; categories: string[]; month: string; category: string | null; canWrite: boolean; tz: string };

/** Expense log (SPEC §11.2): month + category filters, totals, CSV export, Sheet sync, add/edit/delete. */
export function ExpensesView({ rows, total, categories, month, category, canWrite, tz }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<ExpenseRow | null | "new">(null);
  const [busy, setBusy] = useState<string | null>(null);

  function navigate(next: { month?: string; category?: string | null }) {
    const p = new URLSearchParams();
    const m = next.month ?? month;
    const c = next.category === undefined ? category : next.category;
    if (m) p.set("month", m);
    if (c) p.set("category", c);
    router.push(`/admin/expenses?${p.toString()}`);
  }

  async function onExport() {
    setBusy("csv");
    const res = await exportExpensesCsv({ month, category });
    setBusy(null);
    if (!res.ok) return toast(res.error, "err");
    downloadText(`expenses-${month || "all"}.csv`, res.data);
  }
  async function onSync() {
    setBusy("sync");
    const res = await syncExpensesToSheet();
    setBusy(null);
    if (!res.ok) return toast(res.error, "err");
    toast(res.data.created ? `Sheet created: ${res.data.spreadsheetId} — set GOOGLE_EXPENSES_SHEET_ID` : `Synced ${res.data.rows} rows`);
  }
  async function onDelete(row: ExpenseRow) {
    if (!confirm(`Delete ${row.category} ${formatINR(row.amount)}?`)) return;
    const res = await deleteExpense(row.id);
    if (!res.ok) return toast(res.error, "err");
    toast("Deleted");
    router.refresh();
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="bg-brand-blue px-4 pb-3 pt-3 text-white">
        <div className="flex items-center gap-2">
          <input type="month" value={month} onChange={(e) => navigate({ month: e.target.value })} className="rounded-lg bg-white/20 px-2 py-1 text-sm text-white" />
          <button type="button" onClick={() => navigate({ month: "" })} className="text-xs underline opacity-80">
            all time
          </button>
          <div className="ml-auto text-right">
            <div className="text-[11px] uppercase opacity-80">Total</div>
            <div className="text-lg font-bold">{formatINR(total)}</div>
          </div>
        </div>
        <div className="scrollbar-none mt-2 flex gap-2 overflow-x-auto">
          <Pill active={!category} onClick={() => navigate({ category: null })}>
            All
          </Pill>
          {categories.map((c) => (
            <Pill key={c} active={category?.toLowerCase() === c.toLowerCase()} onClick={() => navigate({ category: c })}>
              {c}
            </Pill>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 px-4 py-2">
        {canWrite ? (
          <button type="button" className={btnPrimary} onClick={() => setEditing("new")}>
            + Add expense
          </button>
        ) : null}
        <button type="button" className={btnSecondary} disabled={busy === "csv"} onClick={onExport}>
          Export CSV
        </button>
        {canWrite ? (
          <button type="button" className={btnSecondary} disabled={busy === "sync"} onClick={onSync}>
            {busy === "sync" ? "Syncing…" : "Sync to Google Sheet"}
          </button>
        ) : null}
      </div>

      <ul className="divide-y bg-white">
        {rows.length === 0 ? <li className="px-4 py-8 text-center text-sm text-gray-500">No expenses in this period.</li> : null}
        {rows.map((r) => (
          <li key={r.id} className="px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">{r.category}</span>
                  {r.vendor ? <span className="truncate text-xs text-gray-500">· {r.vendor}</span> : null}
                </div>
                <div className="text-xs text-gray-500">
                  {fmtDay(r.date, tz)} · {r.createdBy}
                  {r.tags.length ? ` · ${r.tags.map((t) => `#${t}`).join(" ")}` : ""}
                </div>
                {r.note ? <div className="mt-0.5 text-xs text-gray-700">{r.note}</div> : null}
                <div className="mt-1 flex gap-3 text-xs">
                  {r.hasReceipt ? (
                    <a href={`/api/files/expense/${r.id}/receipt`} target="_blank" rel="noreferrer" className="text-brand-blue underline">
                      🧾 bill
                    </a>
                  ) : null}
                  {r.hasVoice ? (
                    <a href={`/api/files/expense/${r.id}/voice`} target="_blank" rel="noreferrer" className="text-brand-blue underline">
                      🎤 voice {r.voiceDurationSec ? `${r.voiceDurationSec}s` : ""}
                    </a>
                  ) : null}
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold">{formatINR(r.amount)}</div>
                {canWrite ? (
                  <div className="mt-1 flex justify-end gap-2 text-xs">
                    <button type="button" className="text-brand-blue" onClick={() => setEditing(r)}>
                      Edit
                    </button>
                    <button type="button" className="text-red-600" onClick={() => onDelete(r)}>
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>

      <Sheet open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add expense" : "Edit expense"}>
        {editing !== null ? (
          <ExpenseForm
            initial={editing === "new" ? null : editing}
            categories={categories}
            onDone={() => {
              setEditing(null);
              router.refresh();
            }}
          />
        ) : null}
      </Sheet>
    </div>
  );
}
