"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { VaultItemKind } from "@prisma/client";
import { Pill } from "@/components/ui/Pill";
import { Sheet, ActionList } from "@/components/ui/Sheet";
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

  return (
    <div className="flex flex-1 flex-col">
      <div className="bg-brand-blue-dark px-3 pb-3 text-white">
        <div className="flex items-center justify-between py-1">
          <h1 className="text-base font-semibold">Client Vault</h1>
          <div className="flex items-center gap-1">
            <button type="button" className="touch-target rounded-full px-2 text-sm font-medium hover:bg-white/15" onClick={() => setClientSheet(true)}>
              Add Client
            </button>
            <button
              type="button"
              aria-label="Add item"
              title={client ? "Add item" : "Pick a client first"}
              disabled={!client}
              className="touch-target rounded-full text-2xl leading-none hover:bg-white/15 disabled:opacity-40"
              onClick={() => setItemSheet({ open: true, item: null })}
            >
              +
            </button>
          </div>
        </div>
        <div className="scrollbar-none -mx-3 flex gap-2 overflow-x-auto px-3 py-1">
          {clients.length === 0 ? <span className="text-xs text-white/70">No clients yet — use &ldquo;Add Client&rdquo;.</span> : null}
          {clients.map((c) => (
            <Pill key={c.id} active={c.id === clientId} onClick={() => go({ clientId: c.id })}>
              {c.name}
            </Pill>
          ))}
        </div>
      </div>

      <div className="flex border-b bg-white">
        {TABS.map((t) => (
          <button
            key={t.kind}
            type="button"
            onClick={() => go({ tab: t.kind })}
            className={clsx(
              "touch-target flex-1 border-b-2 py-2 text-xs font-medium",
              t.kind === tab ? "border-brand-blue text-brand-blue" : "border-transparent text-gray-500",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {client ? (
        <div className="flex items-center justify-between px-4 py-2 text-xs text-gray-500">
          <span>
            {client.name} · {items.length} item{items.length === 1 ? "" : "s"}
          </span>
          <button type="button" className="font-medium text-brand-blue" onClick={() => setGrantTarget({ clientId: client.id, label: `all of ${client.name}` })}>
            Grant whole client
          </button>
        </div>
      ) : (
        <p className="px-4 py-6 text-center text-sm text-gray-500">Pick a client to see its vault.</p>
      )}

      <ul className="space-y-2 px-3 pb-24">
        {client && items.length === 0 ? <li className="py-6 text-center text-sm text-gray-400">Nothing here yet. Tap + to add.</li> : null}
        {items.map((it) => (
          <li key={it.id} className="rounded-xl bg-white p-3 shadow-sm">
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
            <div className="mt-2 border-t pt-2">
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
    </div>
  );
}
