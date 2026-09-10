"use client";
import { useState } from "react";
import Link from "next/link";
import { Sheet } from "@/components/ui/Sheet";
import { Field, inputCls, btnSecondary } from "@/components/ui/Field";
import { EmptyState, Fab, FormFooter, ListRow, ScreenHeader, StatusPill, useAdminAction } from "@/components/admin/AdminUi";
import { createClient, setClientActive, updateClient } from "@/server/admin/actions";
import type { ClientRow } from "@/server/admin/queries";
import type { ClientInput } from "@/server/admin/schemas";

/** /admin/clients — "Add Client" (SPEC §11.1). Vault items are managed at /admin/vault. */
export function ClientsManager({ clients }: { clients: ClientRow[] }) {
  const { busy, run } = useAdminAction();
  const [editing, setEditing] = useState<ClientRow | null>(null);
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
    setEditing(null);
  };

  const submit = async (values: ClientInput) => {
    const res = editing ? await run(updateClient({ ...values, id: editing.id }), "Saved") : await run(createClient(values), "Client added");
    if (res) close();
  };
  const toggle = async (c: ClientRow) => {
    const res = await run(setClientActive(c.id, !c.active), c.active ? "Deactivated" : "Activated");
    if (res) close();
  };

  return (
    <div className="flex flex-1 flex-col pb-24">
      <ScreenHeader title="Clients" subtitle="Clients appear in dashboard filters once they have a task" />
      {clients.length === 0 ? <EmptyState>No clients yet. Tap ＋ to add one.</EmptyState> : null}
      {clients.map((c) => (
        <ListRow
          key={c.id}
          title={c.name}
          subtitle={
            <>
              {[c.contact, c.email].filter(Boolean).join(" · ") || "No contact"} · {c._count.tasks} task{c._count.tasks === 1 ? "" : "s"}
              {c.visibleInFilters ? " · in filters" : ""}
            </>
          }
          trailing={
            <span className="flex items-center gap-2">
              <Link href={`/admin/vault?clientId=${c.id}`} onClick={(e) => e.stopPropagation()} className="touch-target flex items-center text-lg" aria-label="Client vault" title="Client vault">
                🔐
              </Link>
              <StatusPill active={c.active} />
            </span>
          }
          inactive={!c.active}
          onClick={() => {
            setEditing(c);
            setOpen(true);
          }}
        />
      ))}
      <Fab onClick={() => setOpen(true)} label="Add client" />
      <Sheet open={open} onClose={close} title={editing ? "Edit client" : "Add client"}>
        {open ? <ClientForm key={editing?.id ?? "new"} client={editing} busy={busy} onSubmit={submit} onCancel={close} onToggle={editing ? () => toggle(editing) : undefined} /> : null}
      </Sheet>
    </div>
  );
}

function ClientForm({
  client,
  busy,
  onSubmit,
  onCancel,
  onToggle,
}: {
  client: ClientRow | null;
  busy: boolean;
  onSubmit: (v: ClientInput) => void;
  onCancel: () => void;
  onToggle?: () => void;
}) {
  const [v, setV] = useState<ClientInput>({
    name: client?.name ?? "",
    contact: client?.contact ?? "",
    email: client?.email ?? "",
    gstNumber: client?.gstNumber ?? "",
    address: client?.address ?? "",
  });
  const set = (k: keyof ClientInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <form
      className="flex flex-col gap-3 px-4 pb-2 pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
    >
      <Field label="Client name">
        <input className={inputCls} required value={v.name} onChange={set("name")} />
      </Field>
      <Field label="Contact person / phone">
        <input className={inputCls} value={v.contact ?? ""} onChange={set("contact")} />
      </Field>
      <Field label="Email" hint="Invoices and receipts are sent here">
        <input className={inputCls} type="email" value={v.email ?? ""} onChange={set("email")} />
      </Field>
      <Field label="GST number">
        <input className={inputCls} value={v.gstNumber ?? ""} onChange={set("gstNumber")} />
      </Field>
      <Field label="Address">
        <textarea className={inputCls} rows={3} value={v.address ?? ""} onChange={set("address")} />
      </Field>
      {client ? (
        <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
          <div>
            Drive folder:{" "}
            {client.driveFolderId ? (
              <a className="text-brand-blue underline" href={`https://drive.google.com/drive/folders/${client.driveFolderId}`} target="_blank" rel="noreferrer">
                open in Drive
              </a>
            ) : (
              <span className="text-gray-400">created with the first task</span>
            )}
          </div>
          <div>Visible in dashboard filters: {client.visibleInFilters ? "yes" : "not yet (needs a task)"}</div>
          <div>
            Vault items: {client._count.vaultItems} ·{" "}
            <Link className="text-brand-blue underline" href={`/admin/vault?clientId=${client.id}`}>
              manage vault
            </Link>
          </div>
        </div>
      ) : null}
      <FormFooter
        busy={busy}
        onCancel={onCancel}
        extra={
          onToggle ? (
            <button type="button" className={btnSecondary} disabled={busy} onClick={onToggle}>
              {client?.active ? "Deactivate" : "Activate"}
            </button>
          ) : null
        }
      />
    </form>
  );
}
