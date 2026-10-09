"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { BarChip, BarIcon, BottomZone, ZoneRow } from "@/components/ui/BottomZone";
import { exportFinanceCsv, syncFinance } from "@/server/finance/finance";
import { downloadText } from "@/components/finance/finance-ui";

/** Finance bottom zone (SPEC §11.4, §5.4): CSV export and the push-only Google Sheet mirror in the bar, "Open sheet" in the green area. ADMIN only. */
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
  type Sync = { spreadsheetId: string; created: boolean; rows: number };
  const describe = (d: Sync) => (d.created ? `Sheet created: ${d.spreadsheetId} — set GOOGLE_FINANCE_SHEET_ID` : `Pushed ${d.rows} rows to the sheet`);

  return (
    <BottomZone
      menu
      rows={
        <ZoneRow label="Google Sheet">
          {sheetId ? (
            <a
              href={`https://docs.google.com/spreadsheets/d/${sheetId}`}
              target="_blank"
              rel="noreferrer"
              className="no-select flex h-[22px] shrink-0 items-center whitespace-nowrap rounded-full bg-green-pill px-2.5 text-[11px] leading-none text-[#111]"
            >
              Open sheet ↗
            </a>
          ) : null}
          <span className="truncate text-[11px] text-white/90">Read-only mirror — sheet edits are never imported</span>
        </ZoneRow>
      }
      right={
        <>
          <BarIcon tone="white" label={busy === "csv" ? "Exporting CSV" : "Export CSV"} onClick={busy ? undefined : () => run("csv", exportFinanceCsv, (csv: string) => downloadText("finance.csv", csv))}>
            <Download size={20} />
          </BarIcon>
          {canWrite ? (
            <BarChip
              label="Push to Google Sheet"
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
              {busy === "sync" ? "Pushing…" : "Push to Sheet"}
            </BarChip>
          ) : null}
        </>
      }
    />
  );
}
