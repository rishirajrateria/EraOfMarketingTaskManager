import Link from "next/link";
import { Building2, ChevronRight, ExternalLink, FolderKey } from "lucide-react";
import { requireAdminPage } from "@/server/admin/guard";
import { listKitRows, type KitRow } from "@/server/clients/kit-queries";
import { getSettings } from "@/lib/settings";
import { fmtDate } from "@/lib/time";
import { EmptyState, Screen, ScreenHeader } from "@/components/admin/AdminUi";
import { BarIcon, BottomZone } from "@/components/ui/BottomZone";
import { CreateKitButton, SendKitButtons } from "@/components/clients/KitActions";
import { KitShareButton } from "@/components/clients/KitShareSheet";
import { KitFlowZone } from "@/components/clients/KitFlowZone";

export const dynamic = "force-dynamic";

function Status({ r, tz }: { r: KitRow; tz: string }) {
  if (r.ready) {
    const sent = r.sentAt ? `sent ${fmtDate(new Date(r.sentAt), tz, "d MMM")} by ${r.sentVia === "WHATSAPP" ? "WhatsApp" : "email"}` : "not sent yet";
    return <span className="text-emerald-700 dark:text-emerald-300">Kit ready · {sent}</span>;
  }
  if (r.partial) return <span className="text-amber-700 dark:text-amber-300">Kit incomplete · tap Repair</span>;
  return <span className="text-muted">No kit yet</span>;
}

function KitCard({ r, tz }: { r: KitRow; tz: string }) {
  const app = r.vault.assets + r.vault.credentials;
  return (
    <section className="glass-card mx-4 mt-2.5 p-2.5">
      <div className="flex items-center gap-2">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white ${r.ready ? "bg-[linear-gradient(150deg,#38bdf8,#0284c7)]" : "bg-[linear-gradient(150deg,#94a3b8,#64748b)]"}`}>
          <FolderKey size={18} />
        </span>
        <Link href={`/admin/client-kit/${r.clientId}`} className="min-w-0 flex-1">
          <b className="block truncate text-[14.5px] font-semibold">{r.displayName}</b>
          <small className="block truncate text-[12px]"><Status r={r} tz={tz} /></small>
        </Link>
        <Link href={`/admin/client-kit/${r.clientId}`} aria-label={`${r.displayName} kit details`} className="flex h-8 w-8 shrink-0 items-center justify-center text-muted">
          <ChevronRight size={18} />
        </Link>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {r.ready && r.folderId && r.urls && r.messages ? (
          <>
            <KitShareButton clientId={r.clientId} scopes={r.shareScopes} displayName={r.displayName} />
            <a href={r.urls.folder} target="_blank" rel="noreferrer" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-hair bg-chip text-ink active:opacity-70" aria-label={`Open ${r.displayName} kit in Drive`} title="Open in Drive"><ExternalLink size={14} /></a>
            <SendKitButtons contact={{ clientId: r.clientId, name: r.displayName, email: r.email, whatsapp: r.whatsapp, messages: r.messages }} />
          </>
        ) : (
          <CreateKitButton clientId={r.clientId} repair={r.partial} />
        )}
      </div>
      {app ? (
        <Link href={`/admin/client-kit/${r.clientId}#saved`} className="mt-1.5 block truncate px-0.5 text-[11.5px] text-muted">
          Saved in the app: {r.vault.assets} asset link{r.vault.assets === 1 ? "" : "s"} · {r.vault.credentials} credential{r.vault.credentials === 1 ? "" : "s"} ›
        </Link>
      ) : null}
    </section>
  );
}

/**
 * Client kit (ADR 0014): every client's Drive kit — create, share, send — plus what is saved in the app's vault. ADMIN only.
 * From the "+" speed dial (`?add=1|min&from=add`) its add form is the "New client kit" picker (KitFlowZone).
 */
export default async function ClientKitPage() {
  await requireAdminPage();
  const [{ rows, owner, folders }, settings] = await Promise.all([listKitRows(), getSettings()]);
  const ready = rows.filter((r) => r.ready).length;
  return (
    <Screen
      header={<ScreenHeader title="Client kit" subtitle={`${ready} of ${rows.length} clients have a kit · ${owner ? `${owner}'s Drive` : "Google Drive"} › Client Kit`} />}
      zone={<KitFlowZone zone={<BottomZone left={<span className="truncate text-[11px] text-white/90">{folders.join(" · ")}</span>} right={<BarIcon href="/admin/clients" label="Clients" tone="white"><Building2 size={20} /></BarIcon>} />} />}
      className="pb-4"
    >
      <p className="px-4 pt-2 text-[11.5px] leading-snug text-muted">
        One Drive folder per client with {folders.slice(0, -1).join(", ")} and {folders.at(-1)}, plus a ready-made Credentials sheet. The client gets Editor access to upload assets and fill the sheet; send them the link by email or WhatsApp.
      </p>
      {rows.length === 0 ? <EmptyState>No active clients yet.</EmptyState> : null}
      {rows.map((r) => (
        <KitCard key={r.clientId} r={r} tz={settings.timezone} />
      ))}
    </Screen>
  );
}
