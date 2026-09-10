"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { btnPrimary, btnSecondary } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { exportFinanceCsv, pullFinancePayments, syncFinance } from "@/server/finance/finance";
import { downloadText } from "@/components/finance/finance-ui";

/** Finance sheet buttons (SPEC §11.4): CSV export (ADMIN/CA), two-way Google Sheet sync (ADMIN). */
export function FinanceActions({ canWrite, sheetId }: { canWrite: boolean; sheetId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(name: string, fn: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>, onOk: (d: never) => void) {
    setBusy(name);
    const res = await fn();
    setBusy(null);
    if (!res.ok) return toast(res.error, "err");
    onOk(res.data as never);
  }
  type Sync = { spreadsheetId: string; created: boolean; rows: number; imported?: number; skipped?: number };
  const describe = (d: Sync) => (d.created ? `Sheet created: ${d.spreadsheetId} — set GOOGLE_FINANCE_SHEET_ID` : `Synced ${d.rows} rows${d.imported != null ? ` · imported ${d.imported} payment(s)` : ""}`);

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2">
      <button className={btnSecondary} disabled={!!busy} onClick={() => run("csv", exportFinanceCsv, (csv: string) => downloadText("finance.csv", csv))}>Export CSV</button>
      {canWrite ? (
        <>
          <button className={btnPrimary} disabled={!!busy} onClick={() => run("sync", syncFinance, (d: Sync) => { toast(describe(d)); router.refresh(); })}>{busy === "sync" ? "Syncing…" : "Sync Finance sheet"}</button>
          <button className={btnSecondary} disabled={!!busy} onClick={() => run("pull", pullFinancePayments, (d: Sync) => { toast(`Imported ${d.imported ?? 0}, skipped ${d.skipped ?? 0}`); router.refresh(); })}>{busy === "pull" ? "Pulling…" : "Pull from sheet"}</button>
        </>
      ) : null}
      {sheetId ? (
        <a href={`https://docs.google.com/spreadsheets/d/${sheetId}`} target="_blank" rel="noreferrer" className="text-xs text-brand-blue underline">Open sheet</a>
      ) : null}
    </div>
  );
}
