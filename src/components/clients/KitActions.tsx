"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus, Mail, MessageCircle, Wrench } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { btnPrimary, inputCls } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { createClientKit, sendClientKit } from "@/server/clients/kit";

/** Client kit buttons (ADR 0014): Create / Repair kit and the Email / WhatsApp send sheet. */
export const kitBtn = "inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-hair bg-chip px-2.5 text-[12px] font-semibold text-ink active:opacity-70 disabled:opacity-45";
const primaryBtn = "inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-primary px-3 text-[12px] font-semibold text-primary-ink active:opacity-80 disabled:opacity-45";

export function CreateKitButton({ clientId, repair = false }: { clientId: string; repair?: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      className={repair ? kitBtn : primaryBtn}
      onClick={() =>
        start(async () => {
          const r = await createClientKit(clientId);
          if (!r.ok) return toast(r.error, "err");
          const what = r.data.repaired ? (r.data.created.length ? `Kit repaired · added ${r.data.created.join(", ")}` : "Kit checked · nothing missing") : "Client kit created";
          toast(r.data.warnings.length ? `${what} · ${r.data.warnings[0]}` : what);
          router.refresh();
        })
      }
    >
      {repair ? <Wrench size={14} /> : <FolderPlus size={14} />} {pending ? (repair ? "Checking…" : "Creating…") : repair ? "Repair" : "Create kit"}
    </button>
  );
}

type Channel = "EMAIL" | "WHATSAPP";
export type KitContact = { clientId: string; name: string; email: string | null; whatsapp: string | null; messages: { email: string; whatsapp: string } };

export function SendKitSheet({ contact, channel: initial, onClose }: { contact: KitContact; channel: Channel; onClose: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const [channel, setChannel] = useState<Channel>(initial);
  const [texts, setTexts] = useState({ EMAIL: contact.messages.email, WHATSAPP: contact.messages.whatsapp });
  const [pending, start] = useTransition();
  const to = channel === "EMAIL" ? contact.email : contact.whatsapp;
  const send = () =>
    start(async () => {
      const r = await sendClientKit(contact.clientId, { channel, text: texts[channel] });
      if (!r.ok) return toast(r.error, "err");
      toast(`Kit sent to ${r.data.to}`);
      router.refresh();
      onClose();
    });
  const tab = (c: Channel, label: string, Icon: typeof Mail, has: string | null) => (
    <button
      type="button"
      aria-pressed={channel === c}
      onClick={() => setChannel(c)}
      className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-[13px] font-semibold ${channel === c ? "bg-primary text-primary-ink" : "text-ink"} ${has ? "" : "opacity-60"}`}
    >
      <Icon size={15} /> {label}
    </button>
  );
  return (
    <Sheet open onClose={onClose} title={`Send kit to ${contact.name}`}>
      <div className="space-y-3 px-4 pb-5">
        <div className="flex gap-1 rounded-2xl border border-hair bg-chip p-1">
          {tab("EMAIL", "Email kit", Mail, contact.email)}
          {tab("WHATSAPP", "WhatsApp kit", MessageCircle, contact.whatsapp)}
        </div>
        {to ? (
          <p className="text-[12px] text-muted">To {to}</p>
        ) : (
          <p className="rounded-xl border border-hair bg-glass px-3 py-2 text-[12.5px] text-amber-700 dark:text-amber-300">
            {channel === "EMAIL" ? "No email on file for this client. Add it on the client (Clients › edit) to email the kit." : "No WhatsApp or phone number on file. Add it on the client (Clients › edit) to WhatsApp the kit."}
          </p>
        )}
        <textarea rows={channel === "EMAIL" ? 12 : 7} value={texts[channel]} maxLength={3000} onChange={(e) => setTexts((t) => ({ ...t, [channel]: e.target.value }))} className={`${inputCls} text-[13.5px] leading-snug`} aria-label="Message" />
        <button type="button" className={`${btnPrimary} w-full`} disabled={pending || !to || !texts[channel].trim()} onClick={send}>
          {pending ? "Sending…" : channel === "EMAIL" ? "Email kit" : "WhatsApp kit"}
        </button>
      </div>
    </Sheet>
  );
}

/** "Email kit" and "WhatsApp kit" buttons that open the send sheet on that channel. */
export function SendKitButtons({ contact }: { contact: KitContact }) {
  const [open, setOpen] = useState<Channel | null>(null);
  return (
    <>
      <button type="button" className={kitBtn} onClick={() => setOpen("EMAIL")} title={contact.email ? `Email ${contact.email}` : "No email on file"}>
        <Mail size={14} /> Email kit
      </button>
      <button type="button" className={kitBtn} onClick={() => setOpen("WHATSAPP")} title={contact.whatsapp ? `WhatsApp ${contact.whatsapp}` : "No WhatsApp number on file"}>
        <MessageCircle size={14} /> WhatsApp kit
      </button>
      {open ? <SendKitSheet contact={contact} channel={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
