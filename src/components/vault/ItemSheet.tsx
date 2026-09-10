"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { VaultItemKind } from "@prisma/client";
import { Sheet } from "@/components/ui/Sheet";
import { Field, inputCls, btnPrimary } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { createVaultItem, updateVaultItem } from "@/server/vault/actions";
import type { VaultItemDto } from "@/server/vault/queries";

/** Add / edit a vault item. The password field is write-only: it is never pre-filled from the server. */
export function ItemSheet({
  open,
  onClose,
  clientId,
  kind,
  item,
}: {
  open: boolean;
  onClose: () => void;
  clientId: string;
  kind: VaultItemKind;
  item?: VaultItemDto | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [clearPassword, setClearPassword] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const typed = String(fd.get("password") ?? "");
    const base = {
      label: String(fd.get("label") ?? ""),
      url: String(fd.get("url") ?? ""),
      username: String(fd.get("username") ?? ""),
      notes: String(fd.get("notes") ?? ""),
    };
    setBusy(true);
    const res = item
      ? await updateVaultItem(item.id, { ...base, password: clearPassword ? "" : typed ? typed : undefined })
      : await createVaultItem({ ...base, clientId, kind, password: typed || null });
    setBusy(false);
    if (!res.ok) return toast(res.error, "err");
    toast(item ? "Item updated" : "Item added");
    onClose();
    router.refresh();
  }

  return (
    <Sheet open={open} onClose={onClose} title={item ? "Edit item" : "Add item"}>
      <form onSubmit={submit} className="space-y-3 px-4 py-4" key={item?.id ?? "new"}>
        <Field label="Label">
          <input name="label" required defaultValue={item?.label ?? ""} className={inputCls} autoFocus />
        </Field>
        <Field label="URL">
          <input name="url" type="url" inputMode="url" defaultValue={item?.url ?? ""} className={inputCls} placeholder="https://" />
        </Field>
        <Field label="Username">
          <input name="username" defaultValue={item?.username ?? ""} className={inputCls} autoComplete="off" />
        </Field>
        <Field label="Password" hint={item?.hasPassword ? "Leave blank to keep the current password. Stored encrypted." : "Stored encrypted."}>
          <input name="password" type="password" className={inputCls} autoComplete="new-password" disabled={clearPassword} />
        </Field>
        {item?.hasPassword ? (
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input type="checkbox" checked={clearPassword} onChange={(e) => setClearPassword(e.target.checked)} />
            Remove the stored password
          </label>
        ) : null}
        <Field label="Notes">
          <textarea name="notes" rows={2} defaultValue={item?.notes ?? ""} className={inputCls} />
        </Field>
        <button type="submit" className={`${btnPrimary} w-full`} disabled={busy}>
          {busy ? "Saving…" : item ? "Save" : "Add item"}
        </button>
      </form>
    </Sheet>
  );
}
