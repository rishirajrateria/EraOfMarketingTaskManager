"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, ExternalLink, Sheet } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { exportFinanceCsv, syncFinance } from "@/server/finance/finance";
import { downloadText } from "@/components/finance/finance-ui";

/**
 * Finance sheet actions (SPEC §11.4) on the Payments & finance hub's summary (ADR 0013): CSV export, the push-only
 * Google Sheet mirror and "Open sheet". ADMIN only.
 */
type Sync = { spreadsheetId: string; created: boolean; rows: number };
const chip = "inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-hair bg-chip px-2.5 text-[11.5px] font-semibold text-ink active:opacity-70 disabled:opacity-45";

export function FinanceSheetActions({ canWrite, sheetId }: { canWrite: boolean; sheetId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function run<T>(name: string, fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, onOk: (d: T) => void) {
    setBusy(name);
    const res = await fn();
    setBusy(null);
    if (!res.ok) return toast(res.error, "err");
    onOk(res.data);
  }
  const describe = (d: Sync) => (d.created ? `Sheet created: ${d.spreadsheetId} — set GOOGLE_FINANCE_SHEET_ID` : `Pushed ${d.rows} rows to the sheet`);

  return (
    <div className="scrollbar-none flex items-center gap-1.5 overflow-x-auto" role="group" aria-label="Finance sheet">
      <button type="button" className={chip} disabled={!!busy} title="Export the finance summary as CSV" onClick={() => run("csv", exportFinanceCsv, (csv: string) => downloadText("finance.csv", csv))}>
        <Download size={13} /> {busy === "csv" ? "Exporting…" : "Export CSV"}
      </button>
      {canWrite ? (
        <button
          type="button"
          className={chip}
          disabled={!!busy}
          title="Push to the Google Sheet (a read-only mirror)"
          onClick={() =>
            run("sync", syncFinance, (d: Sync) => {
              toast(describe(d));
              router.refresh();
            })
          }
        >
          <Sheet size={13} /> {busy === "sync" ? "Pushing…" : "Push to Sheet"}
        </button>
      ) : null}
      {sheetId ? (
        <a href={`https://docs.google.com/spreadsheets/d/${sheetId}`} target="_blank" rel="noreferrer" className={chip}>
          Open sheet <ExternalLink size={12} />
        </a>
      ) : null}
    </div>
  );
}
