"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { VaultItemKind } from "@prisma/client";
import { FolderPlus, Plus, Share2 } from "lucide-react";
import { Sheet, ActionList } from "@/components/ui/Sheet";
import { BarIcon, BottomZone, ZonePill, ZoneRow } from "@/components/ui/BottomZone";
import { Screen, ScreenHeader } from "@/components/admin/AdminUi";
import { btnSecondary } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { clsx } from "@/lib/clsx";
import { deleteVaultItem, revokeGrant } from "@/server/vault/actions";
import type { ClientDto, UserOption, VaultItemDto } from "@/server/vault/queries";
import { ItemSheet } from "@/components/vault/ItemSheet";
import { GrantSheet, type GrantTarget } from "@/components/vault/GrantSheet";
import { ClientSheet } from "@/components/vault/ClientSheet";
import { RevealSecret } from "@/components/vault/RevealSecret";
import { ExpiryLine } from "@/components/vault/ExpiryLine";

const TABS: { kind: VaultItemKind; label: string }[] = [
  { kind: "ASSET_DRIVE_LINK", label: "Assets Drive" },
  { kind: "CREDENTIAL", label: "Credentials" },
  { kind: "SHARED_DRIVE_LINK", label: "Shared Drive" },
];

export function AdminVault({
  clients,
  users,
  clientId,
  tab,
  items,
}: {
  clients: ClientDto[];
  users: UserOption[];
  clientId: string | null;
  tab: VaultItemKind;
  items: VaultItemDto[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [itemSheet, setItemSheet] = useState<{ open: boolean; item: VaultItemDto | null }>({ open: false, item: null });
  const [grantTarget, setGrantTarget] = useState<GrantTarget | null>(null);
  const [clientSheet, setClientSheet] = useState(false);
  const [menuItem, setMenuItem] = useState<VaultItemDto | null>(null);
  const client = clients.find((c) => c.id === clientId) ?? null;

  const go = (next: { clientId?: string | null; tab?: VaultItemKind }) => {
    const q = new URLSearchParams();
    const cid = next.clientId === undefined ? clientId : next.clientId;
    if (cid) q.set("clientId", cid);
    q.set("tab", next.tab ?? tab);
    router.push(`/admin/vault?${q.toString()}`);
  };

  async function remove(item: VaultItemDto) {
    if (!confirm(`Delete "${item.label}"? Grants and view logs go with it.`)) return;
    const res = await deleteVaultItem(item.id);
    if (!res.ok) return toast(res.error, "err");
    toast("Item deleted");
    router.refresh();
  }

  async function revoke(grantId: string, who: string) {
    const res = await revokeGrant(grantId);
    if (!res.ok) return toast(res.error, "err");
    toast(`Access revoked for ${who}`);
    router.refresh();
  }

  const subtitle = client ? `${client.name} · ${items.length} item${items.length === 1 ? "" : "s"}` : clients.length === 0 ? "No clients yet — tap the folder icon to add one." : "Pick a client to see its vault.";

  const zone = (
    <BottomZone
      menu
      rows={
        <>
          <ZoneRow label="Clients">
            {clients.length === 0 ? <span className="text-[11px] text-white/90">No clients yet</span> : null}
            {clients.map((c) => (
              <ZonePill key={c.id} active={c.id === clientId} onClick={() => go({ clientId: c.id })}>
                {c.name}
              </ZonePill>
            ))}
          </ZoneRow>
          <ZoneRow label="Sections">
            {TABS.map((t) => (
              <ZonePill key={t.kind} active={t.kind === tab} onClick={() => go({ tab: t.kind })}>
                {t.label}
              </ZonePill>
            ))}
          </ZoneRow>
        </>
      }
      right={
        <>
          <BarIcon tone="white" label="Add Client" onClick={() => setClientSheet(true)}>
            <FolderPlus size={20} />
          </BarIcon>
          <BarIcon tone="white" label="Grant whole client" onClick={() => (client ? setGrantTarget({ clientId: client.id, label: `all of ${client.name}` }) : toast("Pick a client first", "err"))}>
            <Share2 size={20} />
          </BarIcon>
          <BarIcon tone="white" label="Add item" onClick={() => (client ? setItemSheet({ open: true, item: null }) : toast("Pick a client first", "err"))}>
            <Plus size={24} strokeWidth={2.75} />
          </BarIcon>
        </>
      }
    />
  );

  return (
    <Screen header={<ScreenHeader title="Client Vault" subtitle={subtitle} />} zone={zone}>
      <ul className="space-y-2 px-3 py-3">
        {!client ? <li className="py-6 text-center text-sm text-gray-500">Pick a client in the green area to see its vault.</li> : null}
        {client && items.length === 0 ? <li className="py-6 text-center text-sm text-gray-400">Nothing here yet. Tap + to add.</li> : null}
        {items.map((it) => (
          <li key={it.id} className="glass rounded-2xl p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{it.label}</div>
                {it.url ? (
                  <a href={it.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-brand-blue underline">
                    {it.url}
                  </a>
                ) : null}
                {it.username ? <div className="text-xs text-gray-600">User: {it.username}</div> : null}
                {it.notes ? <div className="mt-1 whitespace-pre-wrap text-xs text-gray-500">{it.notes}</div> : null}
              </div>
              <button type="button" aria-label="More" className="touch-target -mr-2 text-xl text-gray-400" onClick={() => setMenuItem(it)}>
                ⋮
              </button>
            </div>
            <div className="mt-2">
              <RevealSecret itemId={it.id} hasPassword={it.hasPassword} />
            </div>
            <div className="mt-2 border-t border-white/60 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium uppercase text-gray-400">Access</span>
                <button type="button" className={`${btnSecondary} !min-h-8 !py-1 text-xs`} onClick={() => setGrantTarget({ itemId: it.id, label: it.label })}>
                  Grant
                </button>
              </div>
              {it.grants.length === 0 ? <div className="text-xs text-gray-400">Admin only</div> : null}
              <ul className="mt-1 space-y-1">
                {it.grants.map((g) => (
                  <li key={g.id} className="flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0 flex-1">
                      <span className={clsx("font-medium", !g.active && "text-red-600 line-through")}>{g.userName}</span>{" "}
                      <ExpiryLine grant={g} />
                    </div>
                    <button type="button" className="text-red-600" onClick={() => revoke(g.id, g.userName)}>
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ul>

      {client ? (
        <ItemSheet open={itemSheet.open} onClose={() => setItemSheet({ open: false, item: null })} clientId={client.id} kind={tab} item={itemSheet.item} />
      ) : null}
      <GrantSheet open={!!grantTarget} onClose={() => setGrantTarget(null)} users={users} target={grantTarget} />
      <ClientSheet open={clientSheet} onClose={() => setClientSheet(false)} tab={tab} />
      <Sheet open={!!menuItem} onClose={() => setMenuItem(null)} title={menuItem?.label}>
        <ActionList
          items={[
            {
              label: "Edit",
              onClick: () => {
                setItemSheet({ open: true, item: menuItem });
                setMenuItem(null);
              },
            },
            {
              label: "Grant access",
              onClick: () => {
                if (menuItem) setGrantTarget({ itemId: menuItem.id, label: menuItem.label });
                setMenuItem(null);
              },
            },
            {
              label: "Delete",
              danger: true,
              onClick: () => {
                const it = menuItem;
                setMenuItem(null);
                if (it) void remove(it);
              },
            },
          ]}
        />
      </Sheet>
    </Screen>
  );
}
