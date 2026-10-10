"use client";
import { useState } from "react";
import Link from "next/link";
import { FolderKey, Plus, Search } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { BarChip, BottomZone, ZonePill, ZoneRow } from "@/components/ui/BottomZone";
import { EmptyState, ListRow, ScreenHeader, StatusPill, useAdminAction } from "@/components/admin/AdminUi";
import { ClientForm } from "@/components/admin/ClientForm";
import { createClient, setClientActive, updateClient } from "@/server/admin/actions";
import type { ClientRow } from "@/server/admin/queries";
import type { ClientInput } from "@/server/admin/schemas";

type Filter = "ALL" | "ACTIVE" | "HOLD" | "INACTIVE";

/** /admin/clients — "Add Client" (SPEC §11.1). Each row links to the client kit (ADR 0014) and the vault (/admin/vault). */
export function ClientsManager({ clients, openAdd = false, companyStateCode }: { clients: ClientRow[]; openAdd?: boolean; companyStateCode: string | null }) {
  const { busy, run } = useAdminAction();
  const [editing, setEditing] = useState<ClientRow | null>(null);
  const [open, setOpen] = useState(openAdd);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
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

  const needle = q.trim().toLowerCase();
  const shown = clients.filter((c) => {
    if (filter === "ACTIVE" && !c.active) return false;
    if (filter === "INACTIVE" && c.active) return false;
    if (filter === "HOLD" && !c.workOnHold) return false;
    return !needle || [c.name, c.contact, c.email, c.gstNumber].some((s) => s?.toLowerCase().includes(needle));
  });

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
            onClick={() => {
              setEditing(c);
              setOpen(true);
            }}
          />
        ))}
      </div>
      <BottomZone
        strip={
          <label className="flex flex-1 items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-sm">
            <Search size={14} className="text-gray-500" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search clients" className="w-full bg-transparent text-sm outline-none" aria-label="Search clients" />
          </label>
        }
        rows={
          <ZoneRow label="Client filter">
            {(["ALL", "ACTIVE", "HOLD", "INACTIVE"] as Filter[]).map((f) => (
              <ZonePill key={f} active={filter === f} onClick={() => setFilter(f)}>{f === "ALL" ? "All" : f === "ACTIVE" ? "Active" : f === "HOLD" ? "On hold" : "Inactive"}</ZonePill>
            ))}
          </ZoneRow>
        }
        left={<span className="text-[11px] text-white/90">{shown.length} client{shown.length === 1 ? "" : "s"}</span>}
        right={
          <BarChip onClick={() => setOpen(true)} label="Add client">
            <Plus size={12} className="mr-1" /> Add client
          </BarChip>
        }
      />
      <Sheet open={open} onClose={close} title={editing ? "Edit client" : "Add client"}>
        {open ? <ClientForm key={editing?.id ?? "new"} client={editing} busy={busy} companyStateCode={companyStateCode} onSubmit={submit} onCancel={close} onToggle={editing ? () => toggle(editing) : undefined} /> : null}
      </Sheet>
    </div>
  );
}
