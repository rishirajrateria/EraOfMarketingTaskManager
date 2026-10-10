import Link from "next/link";
import { notFound } from "next/navigation";
import { Briefcase, ChartNoAxesColumn, ChevronRight, ExternalLink, FileSpreadsheet, KeyRound, Link2, Palette, type LucideIcon } from "lucide-react";
import { requireAdminPage } from "@/server/admin/guard";
import { getKitDetail } from "@/server/clients/kit-queries";
import { getSettings } from "@/lib/settings";
import { fmtDate } from "@/lib/time";
import { Screen, ScreenHeader } from "@/components/admin/AdminUi";
import { BarIcon, BottomZone } from "@/components/ui/BottomZone";
import { CreateKitButton, SendKitButtons, kitBtn } from "@/components/clients/KitActions";
import { ShareFolderButton } from "@/components/finance/drive/DriveShareSheet";

export const dynamic = "force-dynamic";

function FolderRow({ icon: Icon, name, hint, href, tone }: { icon: LucideIcon; name: string; hint: string; href: string | null; tone: string }) {
  const body = (
    <>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-white ${tone}`}><Icon size={16} /></span>
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[14px] font-semibold">{name}</b>
        <small className="block truncate text-[11.5px] text-muted">{hint}</small>
      </span>
      {href ? <ExternalLink size={14} className="shrink-0 text-muted" /> : null}
    </>
  );
  const cls = "flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0";
  return href ? <a href={href} target="_blank" rel="noreferrer" className={`${cls} active:bg-chip`}>{body}</a> : <div className={cls}>{body}</div>;
}

/** One client's kit (ADR 0014): its Drive folders and sheet, share / send / repair, and what is saved in the app's vault. */
export default async function ClientKitDetailPage({ params }: { params: Promise<{ clientId: string }> }) {
  await requireAdminPage();
  const { clientId } = await params;
  const [d, settings] = await Promise.all([getKitDetail(clientId), getSettings()]);
  if (!d) notFound();
  const { row: r, folders } = d;
  const tz = settings.timezone;
  const assets = d.vaultItems.filter((i) => i.kind === "ASSET_DRIVE_LINK");
  const creds = d.vaultItems.filter((i) => i.kind === "CREDENTIAL");
  const subtitle = r.ready
    ? `Created ${fmtDate(new Date(r.createdAt!), tz, "d MMM yyyy")}${r.sharedWith ? ` · ${r.sharedWith} can edit` : " · not shared with the client"}${r.sentAt ? ` · sent ${fmtDate(new Date(r.sentAt), tz, "d MMM")}` : ""}`
    : r.partial ? "Kit incomplete — Repair adds what is missing" : "No kit yet";
  return (
    <Screen
      header={<ScreenHeader title={`${r.displayName} · Client kit`} subtitle={subtitle} />}
      zone={<BottomZone left={<Link href="/admin/client-kit" className="truncate text-[11px] text-white/90">‹ All client kits</Link>} right={<BarIcon href={`/admin/vault?clientId=${r.clientId}&tab=CREDENTIAL`} label="Open the vault" tone="white"><KeyRound size={20} /></BarIcon>} />}
      className="pb-4"
    >
      <div className="flex flex-wrap items-center gap-1.5 px-4 pt-2">
        {r.ready && r.folderId && r.urls && r.messages ? (
          <>
            <ShareFolderButton folderId={r.folderId} title={`Client kit › ${r.displayName}`} />
            <a href={r.urls.folder} target="_blank" rel="noreferrer" className={kitBtn}><ExternalLink size={13} /> Open</a>
            <SendKitButtons contact={{ clientId: r.clientId, name: r.displayName, email: r.email, whatsapp: r.whatsapp, messages: r.messages }} />
            <CreateKitButton clientId={r.clientId} repair />
          </>
        ) : (
          <CreateKitButton clientId={r.clientId} repair={r.partial} />
        )}
      </div>

      {r.urls ? (
        <section className="mx-4 mt-3">
          <h2 className="mb-1.5 px-1 text-[11px] font-bold uppercase tracking-[.08em] text-muted">In Google Drive</h2>
          <div className="overflow-hidden rounded-[18px] border border-hair bg-glass shadow-[var(--shadow)]">
            <FolderRow icon={Palette} name={folders[0]} hint="The client uploads logos, fonts and brand assets" href={r.urls.brand} tone="bg-[linear-gradient(150deg,#f472b6,#db2777)]" />
            <FolderRow icon={KeyRound} name={folders[1]} hint="Holds the credentials sheet" href={r.urls.credentials} tone="bg-[linear-gradient(150deg,#fbbf24,#d97706)]" />
            <FolderRow icon={FileSpreadsheet} name={`${r.displayName} — Credentials`} hint="Sheet · Way dropdown · How to fill tab" href={r.urls.sheet} tone="bg-[linear-gradient(150deg,#34d399,#059669)]" />
            <FolderRow icon={Briefcase} name={folders[2]} hint="We upload the work we create for them" href={r.urls.work} tone="bg-[linear-gradient(150deg,#38bdf8,#0284c7)]" />
            <FolderRow icon={ChartNoAxesColumn} name={folders[3]} hint="Reports for the client" href={r.urls.reports} tone="bg-[linear-gradient(150deg,#a78bfa,#7c3aed)]" />
          </div>
        </section>
      ) : (
        <p className="mx-4 mt-3 rounded-2xl border border-dashed border-hair bg-glass px-4 py-5 text-center text-[13px] text-muted">
          Create kit makes Client Kit › {r.displayName} in Google Drive with {folders.join(", ")} and a Credentials sheet, shared with {r.email ?? "the client's email"} as Editor.
        </p>
      )}

      <section id="saved" className="mx-4 mt-4">
        <h2 className="mb-1.5 px-1 text-[11px] font-bold uppercase tracking-[.08em] text-muted">Saved in the app</h2>
        <div className="overflow-hidden rounded-[18px] border border-hair bg-glass shadow-[var(--shadow)]">
          {[...assets, ...creds].map((i) => (
            <Link key={i.id} href={`/admin/vault?clientId=${r.clientId}&tab=${i.kind}`} className="flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0 active:bg-chip">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-chip text-muted">{i.kind === "CREDENTIAL" ? <KeyRound size={14} /> : <Link2 size={14} />}</span>
              <span className="min-w-0 flex-1">
                <b className="block truncate text-[13.5px] font-semibold">{i.label}</b>
                <small className="block truncate text-[11.5px] text-muted">{i.kind === "CREDENTIAL" ? `${i.username ?? "no username"}${i.hasPassword ? " · password ••••••" : ""}` : (i.url ?? "no link")}</small>
              </span>
              <ChevronRight size={15} className="shrink-0 text-muted" />
            </Link>
          ))}
          <Link href={`/admin/vault?clientId=${r.clientId}&tab=ASSET_DRIVE_LINK`} className="flex items-center justify-between border-b border-line px-3 py-2 text-[13px] last:border-b-0">
            <span>Asset drive links · {assets.length}</span><ChevronRight size={15} className="text-muted" />
          </Link>
          <Link href={`/admin/vault?clientId=${r.clientId}&tab=CREDENTIAL`} className="flex items-center justify-between px-3 py-2 text-[13px]">
            <span>Credentials (encrypted vault) · {creds.length}</span><ChevronRight size={15} className="text-muted" />
          </Link>
        </div>
        <p className="mt-1 px-1 text-[11px] text-muted">Passwords stay encrypted; reveal and access grants are in the vault (every view is logged).</p>
      </section>
    </Screen>
  );
}
