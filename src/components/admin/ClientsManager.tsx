"use client";
import { useState } from "react";
import Link from "next/link";
import { FolderKey, Plus, Search } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { BarChip, BottomZone, ZonePill, ZoneRow } from "@/components/ui/BottomZone";
import { EmptyState, ListRow, ScreenHeader, StatusPill, useAdminAction } from "@/components/admin/AdminUi";
import { ClientForm } from "@/components/admin/ClientForm";
import { PeekZone } from "@/components/shell/PeekBar";
import { useAddForm } from "@/components/shell/useAddForm";
import { LIST_FLOWS } from "@/components/shell/list-flow";
import { createClient, setClientActive, updateClient } from "@/server/admin/actions";
import type { ClientRow } from "@/server/admin/queries";
import type { ClientInput } from "@/server/admin/schemas";

type Filter = "ALL" | "ACTIVE" | "HOLD" | "INACTIVE";

/**
 * /admin/clients — "Add Client" (SPEC §11.1). Each row links to the client kit (ADR 0014) and the vault (/admin/vault).
 * `?add=1` opens the add form; from the "+" speed dial's Client (`&from=add`, or `?add=min` from its eye) — and the kit
 * picker's "+ New client" — it is the list flow (useAddForm, ADR 0016 addendum): Escape / tap outside minimise the
 * form to the "Add client" bar above the bottom nav, the corner × returns to the dashboard, a save comes back here
 * with the bar. Editing a client (`?edit=<id>` or a row) is its own sheet and just closes back to the list.
 */
export function ClientsManager({ clients, openAdd = false, editId = null, companyStateCode }: { clients: ClientRow[]; openAdd?: boolean; editId?: string | null; companyStateCode: string | null }) {
  const { busy, run } = useAdminAction();
  const add = useAddForm(openAdd);
  const [formKey, setFormKey] = useState(0); // a blank add form after each save
  // `?edit=<id>` (the card's "Add number", ADR 0017) opens that client's form straight away.
  const [editing, setEditing] = useState<ClientRow | null>(() => clients.find((c) => c.id === editId) ?? null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const closeEdit = () => setEditing(null);

  const create = async (values: ClientInput) => {
    if (!(await run(createClient(values), "Client added"))) return;
    setFormKey((k) => k + 1);
    add.saved();
  };
  const save = async (values: ClientInput) => {
    if (editing && (await run(updateClient({ ...values, id: editing.id }), "Saved"))) closeEdit();
  };
  const toggle = async (c: ClientRow) => {
    if (await run(setClientActive(c.id, !c.active), c.active ? "Deactivated" : "Activated")) closeEdit();
  };

  const needle = q.trim().toLowerCase();
  const shown = clients.filter((c) => {
    if (filter === "ACTIVE" && !c.active) return false;
    if (filter === "INACTIVE" && c.active) return false;
    if (filter === "HOLD" && !c.workOnHold) return false;
    return !needle || [c.name, c.contact, c.email, c.gstNumber].some((s) => s?.toLowerCase().includes(needle));
  });

  const strip = (
    <label className="flex flex-1 items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-sm">
      <Search size={14} className="text-gray-500" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients" className="w-full bg-transparent text-sm outline-none" aria-label="Search clients" />
    </label>
  );
  const rows = (
    <ZoneRow label="Client filter">
      {(["ALL", "ACTIVE", "HOLD", "INACTIVE"] as Filter[]).map((f) => (
        <ZonePill key={f} active={filter === f} onClick={() => setFilter(f)}>
          {f === "ALL" ? "All" : f === "ACTIVE" ? "Active" : f === "HOLD" ? "On hold" : "Inactive"}
        </ZonePill>
      ))}
    </ZoneRow>
  );

  return (
    <div className="flex flex-1 flex-col">
      <ScreenHeader title="Clients" subtitle="Clients appear in dashboard filters once they have a task" />
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {shown.length === 0 ? <EmptyState>{clients.length === 0 ? "No clients yet. Tap + Add client below." : "No clients match."}</EmptyState> : null}
        {shown.map((c) => (
          <ListRow
            key={c.id}
            title={c.name}
            subtitle={
              <>
                {[c.contact, c.email ?? c.whatsapp].filter(Boolean).join(" · ") || "No contact"} · {c._count.tasks} task{c._count.tasks === 1 ? "" : "s"}
                {c.country && c.country !== "IN" ? ` · ${c.country}` : c.stateName ? ` · ${c.stateName}` : ""}
              </>
            }
            trailing={
              <span className="flex items-center gap-2">
                {c.workOnHold ? <span className="rounded-full border border-white/60 bg-red-100/70 px-2 py-0.5 text-[10px] font-semibold text-red-700 backdrop-blur-sm">On hold</span> : null}
                <Link href={`/admin/client-kit/${c.id}`} onClick={(e) => e.stopPropagation()} className="touch-target flex items-center text-muted" aria-label="Client kit" title="Client kit (Drive folders + credentials sheet)"><FolderKey size={18} /></Link>
                <Link href={`/admin/vault?clientId=${c.id}`} onClick={(e) => e.stopPropagation()} className="touch-target flex items-center text-lg" aria-label="Client vault" title="Client vault">🔐</Link>
                <StatusPill active={c.active} />
              </span>
            }
            inactive={!c.active}
            onClick={() => setEditing(c)}
          />
        ))}
      </div>
      {add.inFlow ? (
        <PeekZone label={LIST_FLOWS.CLIENT.peek} onExpand={add.show} strip={strip} rows={rows} />
      ) : (
        <BottomZone
          strip={strip}
          rows={rows}
          left={<span className="text-[11px] text-white/90">{shown.length} client{shown.length === 1 ? "" : "s"}</span>}
          right={
            <BarChip onClick={add.show} label="Add client">
              <Plus size={12} className="mr-1" /> Add client
            </BarChip>
          }
        />
      )}
      <Sheet open={add.open || add.minimised} minimised={add.minimised} onClose={add.dismiss} onCornerClose={add.cancel} title="Add client">
        <ClientForm key={`new-${formKey}`} client={null} busy={busy} companyStateCode={companyStateCode} onSubmit={create} />
      </Sheet>
      <Sheet open={!!editing} onClose={closeEdit} title="Edit client">
        {editing ? <ClientForm key={editing.id} client={editing} busy={busy} companyStateCode={companyStateCode} onSubmit={save} onToggle={() => toggle(editing)} /> : null}
      </Sheet>
    </div>
  );
}
