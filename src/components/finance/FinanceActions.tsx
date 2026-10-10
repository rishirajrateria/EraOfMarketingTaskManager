"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, ExternalLink, Sheet } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { ZonePill, ZoneRow } from "@/components/ui/BottomZone";
import { exportFinanceCsv, syncFinance } from "@/server/finance/finance";
import { downloadText } from "@/components/finance/finance-ui";

/**
 * Finance sheet actions (SPEC §11.4) as a row of the Payments & finance hub's bottom zone (ADR 0013): CSV export,
 * the push-only Google Sheet mirror and "Open sheet". ADMIN only.
 */
type Sync = { spreadsheetId: string; created: boolean; rows: number };

export function FinanceSheetRow({ canWrite, sheetId }: { canWrite: boolean; sheetId: string }) {
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
    <ZoneRow label="Finance sheet">
      <ZonePill label="Export the finance summary as CSV" onClick={busy ? undefined : () => run("csv", exportFinanceCsv, (csv: string) => downloadText("finance.csv", csv))}>
        <Download size={12} className="mr-1" /> {busy === "csv" ? "Exporting…" : "Export CSV"}
      </ZonePill>
      {canWrite ? (
        <ZonePill
          label="Push to Google Sheet (read-only mirror)"
          onClick={
            busy
              ? undefined
              : () =>
                  run("sync", syncFinance, (d: Sync) => {
                    toast(describe(d));
                    router.refresh();
                  })
          }
        >
          <Sheet size={12} className="mr-1" /> {busy === "sync" ? "Pushing…" : "Push to Sheet"}
        </ZonePill>
      ) : null}
      {sheetId ? (
        <a href={`https://docs.google.com/spreadsheets/d/${sheetId}`} target="_blank" rel="noreferrer" className="no-select flex h-7 shrink-0 items-center whitespace-nowrap rounded-full bg-green-pill px-[13px] text-xs font-medium leading-none">
          Open sheet <ExternalLink size={11} className="ml-1" />
        </a>
      ) : null}
    </ZoneRow>
  );
}
