"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/Sheet";
import { Field, inputCls, btnPrimary } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/server/vault/actions";

/** "Add Client" form (SPEC §11.1): name, contact, email, GST, address. */
export function ClientSheet({ open, onClose, tab }: { open: boolean; onClose: () => void; tab: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    const res = await createClient({
      name: String(fd.get("name") ?? ""),
      contact: String(fd.get("contact") ?? ""),
      email: String(fd.get("email") ?? ""),
      gstNumber: String(fd.get("gstNumber") ?? ""),
      address: String(fd.get("address") ?? ""),
    });
    setBusy(false);
    if (!res.ok) return toast(res.error, "err");
    toast("Client added");
    onClose();
    router.push(`/admin/vault?clientId=${res.data.id}&tab=${tab}`);
    router.refresh();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add Client">
      <form onSubmit={submit} className="space-y-3 px-4 py-4">
        <Field label="Client name">
          <input name="name" required className={inputCls} autoFocus />
        </Field>
        <Field label="Contact person / phone">
          <input name="contact" className={inputCls} />
        </Field>
        <Field label="Email">
          <input name="email" type="email" className={inputCls} />
        </Field>
        <Field label="GST number">
          <input name="gstNumber" className={inputCls} />
        </Field>
        <Field label="Address">
          <textarea name="address" rows={2} className={inputCls} />
        </Field>
        <button type="submit" className={`${btnPrimary} w-full`} disabled={busy}>
          {busy ? "Saving…" : "Add client"}
        </button>
      </form>
    </Sheet>
  );
}
