import Link from "next/link";
import { requireFinancePage } from "@/server/finance/guard";
import { driveFolderMonths } from "@/server/finance/drive-folders-queries";
import { formatCurrency } from "@/server/finance/money";
import { Screen, ScreenHeader } from "@/components/admin/AdminUi";
import { BottomZone } from "@/components/ui/BottomZone";

export const dynamic = "force-dynamic";

const files = (n: number) => `${n} file${n === 1 ? "" : "s"}`;

function Line({ icon, name, value, href }: { icon: string; name: string; value: string; href?: string | null }) {
  return (
    <div className="flex justify-between gap-3 py-0.5 text-sm">
      <span>
        {icon}{" "}
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="underline decoration-gray-300 underline-offset-2">{name}</a>
        ) : (
          name
        )}
      </span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/** Monthly Drive folders (ADR 0009, prototype PAGES.drive): this FY's Finance/YYYY-MM folders, newest first. ADMIN only. */
export default async function DriveFoldersPage() {
  await requireFinancePage();
  const { rows, financeUrl, fyKey } = await driveFolderMonths();
  return (
    <Screen
      header={<ScreenHeader title="Monthly Drive folders" subtitle={`Financial year ${fyKey} · Finance › YYYY-MM`} />}
      zone={
        <BottomZone
          left={<span className="truncate text-[11px] text-white/90">Finance › YYYY-MM</span>}
          right={
            financeUrl ? (
              <a href={financeUrl} target="_blank" rel="noreferrer" className="glass-chip flex h-7 items-center whitespace-nowrap rounded-full px-3 text-xs font-semibold text-ink">
                Open Finance folder
              </a>
            ) : (
              <span className="text-[11px] text-muted">Drive unavailable</span>
            )
          }
        />
      }
      className="pb-4"
    >
      <p className="px-4 pt-3 text-xs text-muted">
        On the 1st of every month a folder is created in Google Drive under Finance › YYYY-MM. Approved invoices and attached expense bills are filed into it automatically; bills whose GST you get back are also put in “GST claimable”, ready for your finance person. Cancelled invoices move to “Cancelled invoices” in the month they were issued, stamped CANCELLED, so the number series has no gaps.
      </p>
      {rows.map((r) => (
        <section key={r.month} className="glass-card mx-4 mt-3 p-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">📁 {r.label}</h2>
            {r.urls ? (
              <a href={r.urls.folder} target="_blank" rel="noreferrer" className="glass-chip rounded-full px-2.5 py-0.5 text-xs font-medium">Open in Drive</a>
            ) : (
              <span className="text-[11px] text-muted">Drive unavailable</span>
            )}
          </div>
          <Line icon="🧾" name="Sales invoices" value={files(r.sales)} href={r.urls?.sales} />
          <Line icon="📎" name="Expense bills" value={files(r.bills)} href={r.urls?.bills} />
          <Line icon="✅" name="GST claimable" value={`${files(r.itc)}${r.itcGst ? ` · ${formatCurrency(r.itcGst)}` : ""}`} href={r.urls?.itc} />
          <Line icon="🚫" name="Cancelled invoices" value={files(r.cancelled)} href={r.urls?.cancelled} />
          <div className="mt-2 flex justify-end">
            <Link href={`/admin/expenses?tab=GST&month=${r.month}`} className="glass-chip rounded-full px-2.5 py-0.5 text-xs font-medium">GST pack ›</Link>
          </div>
        </section>
      ))}
    </Screen>
  );
}
