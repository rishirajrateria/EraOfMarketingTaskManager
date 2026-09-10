"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/Sheet";
import { Field, inputCls, btnPrimary } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { grantAccess } from "@/server/vault/actions";
import type { UserOption } from "@/server/vault/queries";

export type GrantTarget = { itemId: string; label: string } | { clientId: string; label: string };

/**
 * Grant access to one item or to every current item of a client (SPEC §11.1).
 * Either or both expiry rules may be set; leaving both empty grants open-ended access.
 */
export function GrantSheet({ open, onClose, users, target }: { open: boolean; onClose: () => void; users: UserOption[]; target: GrantTarget | null }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [unit, setUnit] = useState<60 | 1>(60);

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!target) return;
    const fd = new FormData(e.currentTarget);
    const expiresLocal = String(fd.get("expiresAt") ?? "");
    const afterOpen = Number(fd.get("afterOpen") ?? "");
    setBusy(true);
    const res = await grantAccess({
      userIds: selected,
      ...("itemId" in target ? { itemId: target.itemId } : { clientId: target.clientId }),
      expiresAt: expiresLocal ? new Date(expiresLocal).toISOString() : null,
      expiresAfterFirstOpenMinutes: afterOpen > 0 ? Math.round(afterOpen * unit) : null,
    });
    setBusy(false);
    if (!res.ok) return toast(res.error, "err");
    toast(`Access granted (${res.data.grants} grant${res.data.grants === 1 ? "" : "s"})`);
    setSelected([]);
    onClose();
    router.refresh();
  }

  return (
    <Sheet open={open} onClose={onClose} title={target ? `Grant access · ${target.label}` : "Grant access"}>
      <form onSubmit={submit} className="space-y-3 px-4 py-4">
        {target && "clientId" in target ? (
          <p className="rounded-lg bg-yellow-50 px-3 py-2 text-[11px] text-yellow-800">
            Applies to every item this client has right now. Items added later need a new grant.
          </p>
        ) : null}
        <Field label="Users">
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2">
            {users.length === 0 ? <span className="text-xs text-gray-400">No active users</span> : null}
            {users.map((u) => (
              <label key={u.id} className="flex items-center gap-2 py-1 text-sm">
                <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} />
                <span className="flex-1">{u.name}</span>
                <span className="text-[10px] uppercase text-gray-400">{u.role.replace("_", " ")}</span>
              </label>
            ))}
          </div>
        </Field>
        <Field label="Expires at (optional)">
          <input name="expiresAt" type="datetime-local" className={inputCls} />
        </Field>
        <Field label="Expires after first open (optional)">
          <div className="flex gap-2">
            <input name="afterOpen" type="number" min={1} step={1} className={inputCls} placeholder="e.g. 2" />
            <select value={unit} onChange={(e) => setUnit(Number(e.target.value) as 60 | 1)} className={`${inputCls} w-32`}>
              <option value={60}>hours</option>
              <option value={1}>minutes</option>
            </select>
          </div>
        </Field>
        <button type="submit" className={`${btnPrimary} w-full`} disabled={busy || selected.length === 0}>
          {busy ? "Granting…" : "Grant access"}
        </button>
      </form>
    </Sheet>
  );
}
