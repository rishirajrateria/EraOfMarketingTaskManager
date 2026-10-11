import Link from "next/link";
import { Ban, ExternalLink, FileText, FolderOpen, IndianRupee, Paperclip, type LucideIcon } from "lucide-react";
import { requireFinancePage } from "@/server/finance/guard";
import { driveFolderMonths, type MonthFolderRow } from "@/server/finance/drive-folders-queries";
import { formatCurrency } from "@/server/finance/money";
import { Screen, ScreenHeader } from "@/components/admin/AdminUi";
import { BottomZone } from "@/components/ui/BottomZone";
import { ShareFolderButton } from "@/components/finance/drive/DriveShareSheet";

export const dynamic = "force-dynamic";

const btn = "inline-flex h-8 shrink-0 items-center gap-[3px] whitespace-nowrap rounded-full border border-hair bg-chip px-[7px] text-[11px] font-semibold text-ink active:opacity-70";

function OpenButton({ href, label = "Open in Drive" }: { href: string; label?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={btn}>
      <ExternalLink size={13} /> {label}
    </a>
  );
}

/** One compact count chip of the 2×2 grid; links to the subfolder when Drive is available. */
function CountChip({ icon: Icon, label, count, href, tone }: { icon: LucideIcon; label: string; count: number; href?: string | null; tone: string }) {
  const body = (
    <>
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-white ${tone}`}>
        <Icon size={13} strokeWidth={2.2} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{label}</span>
      <b className="shrink-0 text-[13px] tabular-nums">{count}</b>
    </>
  );
  const cls = "flex min-w-0 items-center gap-1.5 rounded-xl border border-hair bg-chip px-1.5 py-1.5";
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={`${cls} active:opacity-70`} aria-label={`${label}: ${count} file${count === 1 ? "" : "s"}`}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function MonthCard({ r }: { r: MonthFolderRow }) {
  return (
    <section className="glass-card mx-4 mt-2.5 p-2.5">
      <div className="flex items-center gap-1.5">
        <h2 className="min-w-0 flex-1 truncate pl-0.5 text-[14px] font-semibold tracking-[-.01em]">{r.label}</h2>
        {r.urls && r.folderId ? (
          <>
            <ShareFolderButton folderId={r.folderId} title={`Finance › ${r.label}`} />
            <OpenButton href={r.urls.folder} />
          </>
        ) : (
          <span className="text-[11px] text-muted">Drive unavailable</span>
        )}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <CountChip icon={FileText} label="Sales invoices" count={r.sales} href={r.urls?.sales} tone="bg-[linear-gradient(150deg,#38bdf8,#0284c7)]" />
        <CountChip icon={Paperclip} label="Expense bills" count={r.bills} href={r.urls?.bills} tone="bg-[linear-gradient(150deg,#a78bfa,#7c3aed)]" />
        <CountChip icon={IndianRupee} label="GST claimable" count={r.itc} href={r.urls?.itc} tone="bg-[linear-gradient(150deg,#10b981,#059669)]" />
        <CountChip icon={Ban} label="Cancelled" count={r.cancelled} href={r.urls?.cancelled} tone="bg-[linear-gradient(150deg,#f87171,#dc2626)]" />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 pl-0.5">
        <span className="min-w-0 truncate text-[11.5px] text-muted">{r.itcGst ? `${formatCurrency(r.itcGst)} GST to claim` : "No GST to claim"}</span>
        <Link href={`/admin/expenses?tab=GST&month=${r.month}`} className="shrink-0 whitespace-nowrap text-[12px] font-semibold text-brand-blue dark:text-sky-300">GST pack ›</Link>
      </div>
    </section>
  );
}

/** Monthly Drive folders (ADR 0009, ADR 0013): this FY's Finance/YYYY-MM folders in the owner's Drive, newest first. ADMIN only. */
export default async function DriveFoldersPage() {
  await requireFinancePage();
  const { rows, finance, owner, fyKey } = await driveFolderMonths();
  const where = owner ? `Saved in ${owner}'s Google Drive` : "Google Drive";
  return (
    <Screen
      header={<ScreenHeader title="Monthly Drive folders" subtitle={`${where} · FY ${fyKey}`} />}
      zone={
        <BottomZone
          left={<span className="truncate text-[11px] text-white/90">Finance › YYYY-MM</span>}
          right={finance ? <OpenButton href={finance.url} label="Finance" /> : <span className="text-[11px] text-muted">Drive unavailable</span>}
        />
      }
      className="pb-4"
    >
      <section className="glass-card mx-4 mt-2 p-2.5">
        <div className="flex items-center gap-1.5">
          <FolderOpen size={16} className="shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[14px] font-semibold">Finance</h2>
            <p className="truncate text-[11px] text-muted">All months</p>
          </div>
          {finance ? (
            <>
              <ShareFolderButton folderId={finance.id} title="Finance" />
              <OpenButton href={finance.url} />
            </>
          ) : (
            <span className="text-[11px] text-muted">Drive unavailable</span>
          )}
        </div>
      </section>
      <p className="px-4 pt-2.5 text-[11.5px] leading-snug text-muted">
        A folder is made on the 1st of each month. Approved invoices and attached bills are filed automatically; bills with GST you can claim also go to “GST claimable”. Cancelled invoices move to “Cancelled” as “C Invoice No. …”. Proformas are never filed.
      </p>
      {rows.map((r) => (
        <MonthCard key={r.month} r={r} />
      ))}
    </Screen>
  );
}
