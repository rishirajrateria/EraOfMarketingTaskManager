"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { BarChip, BottomZone, ZonePill, ZoneRow } from "@/components/ui/BottomZone";
import { useToast } from "@/components/ui/Toast";
import { formatINR } from "@/server/finance/money";
import type { ExpenseRow } from "@/server/finance/queries";
import { deleteExpense, exportExpensesCsv, syncExpensesToSheet } from "@/server/finance/expenses";
import { ExpenseForm } from "@/components/finance/ExpenseForm";
import { downloadText, fmtDay, monthLabel, shiftMonthKey } from "@/components/finance/finance-ui";

type Props = { rows: ExpenseRow[]; total: number; categories: string[]; month: string; category: string | null; canWrite: boolean; tz: string };

/**
 * Expense log (SPEC §11.2): month + category filters, totals, CSV export, Sheet sync, add/edit/delete.
 * `categories` is the fixed list from Settings (ADR 0004); a filter on a removed category still shows as a chip.
 */
export function ExpensesView({ rows, total, categories, month, category, canWrite, tz }: Props) {
  const router = useRouter();
  const chips = category && !categories.some((c) => c.toLowerCase() === category.toLowerCase()) ? [...categories, category] : categories;
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
      <div className="bg-gradient-to-br from-[#1e63d6]/90 to-[#22c3e6]/80 px-4 pb-3 pt-3 text-white backdrop-blur-xl">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-[11px] uppercase opacity-80">{month ? monthLabel(month) : "All time"}{category ? ` · ${category}` : ""}</div>
            <div className="text-xs opacity-80">{rows.length} expense{rows.length === 1 ? "" : "s"}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase opacity-80">Total</div>
            <div className="text-lg font-bold">{formatINR(total)}</div>
          </div>
        </div>
      </div>

      <ul className="min-h-0 flex-1 divide-y divide-white/60 overflow-y-auto bg-white/55 backdrop-blur-md">
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

      <BottomZone
        rows={
          <>
            <ZoneRow label="Month">
              <ZonePill onClick={() => navigate({ month: shiftMonthKey(month || new Date().toISOString().slice(0, 7), -1) })} label="Previous month">‹</ZonePill>
              <ZonePill active={!!month}>{month ? monthLabel(month) : "Pick month"}</ZonePill>
              <ZonePill onClick={() => navigate({ month: shiftMonthKey(month || new Date().toISOString().slice(0, 7), 1) })} label="Next month">›</ZonePill>
              <ZonePill active={!month} onClick={() => navigate({ month: "" })}>All time</ZonePill>
            </ZoneRow>
            <ZoneRow label="Category">
              <ZonePill active={!category} onClick={() => navigate({ category: null })}>All</ZonePill>
              {chips.map((c) => (
                <ZonePill key={c} active={category?.toLowerCase() === c.toLowerCase()} onClick={() => navigate({ category: c })}>{c}</ZonePill>
              ))}
            </ZoneRow>
          </>
        }
        left={
          <>
            <ZonePill onClick={onExport} className={busy === "csv" ? "opacity-60" : ""}>Export CSV</ZonePill>
            {canWrite ? <ZonePill onClick={onSync} className={busy === "sync" ? "opacity-60" : ""}>{busy === "sync" ? "Syncing…" : "Sync to Sheet"}</ZonePill> : null}
          </>
        }
        right={
          canWrite ? (
            <BarChip onClick={() => setEditing("new")} label="Add expense" className="font-semibold">
              <Plus size={12} className="mr-0.5" /> Add expense
            </BarChip>
          ) : null
        }
      />
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
