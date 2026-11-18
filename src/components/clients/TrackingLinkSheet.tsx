"use client";
import { useEffect, useState, useTransition } from "react";
import { Copy, ExternalLink, Link2, Mail, RefreshCw, Send } from "lucide-react";
import { clsx } from "@/lib/clsx";
import { Sheet } from "@/components/ui/Sheet";
import { btnSecondary } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { WhatsAppIcon } from "@/components/shell/TopIcons";
import { phoneDigits } from "@/components/dashboard/contacts";
import { emailPortalLink, getPortalLink, regeneratePortalLink, type PortalLink } from "@/server/clients/portal-link";

/** Preview: blue in light and dark (the primary button's ink turns dark in dark mode). */
const PREVIEW_BTN =
  "touch-target inline-flex min-h-[46px] items-center justify-center gap-1.5 rounded-[14px] bg-[linear-gradient(150deg,#60a5fa,#2563eb)] px-2 text-[14px] font-semibold text-white shadow-[0_8px_20px_-10px_rgba(0,0,0,.45)]";

/**
 * Client tracking link (prototype `trackerSheet`): the client's public `/c/<token>` page — Copy, Send (email from the
 * default sender, or a WhatsApp deep link with the message filled in) and Preview. "New link" makes a fresh token; the
 * old link stops working.
 */
export function TrackingLinkSheet({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const toast = useToast();
  const [link, setLink] = useState<PortalLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    void getPortalLink(clientId).then((r) => {
      if (!live) return;
      if (r.ok) setLink(r.data);
      else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [clientId]);

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      toast("Link copied");
    } catch {
      window.prompt("Copy this link", link.url);
    }
  };
  const email = () =>
    start(async () => {
      const r = await emailPortalLink(clientId, {});
      if (!r.ok) return toast(r.error, "err");
      toast(`Link emailed to ${r.data.to}`);
      setSending(false);
    });
  const wa = link ? phoneDigits(link.whatsapp) : null;
  const renew = () => {
    if (!window.confirm("Make a new link? The current link stops working straight away.")) return;
    start(async () => {
      const r = await regeneratePortalLink(clientId);
      if (!r.ok) return toast(r.error, "err");
      setLink(r.data);
      toast("New link made · the old one no longer works");
    });
  };

  return (
    <Sheet open onClose={onClose} title="Client tracking link">
      <div className="space-y-3 px-4 pb-5">
        <p className="text-[12.5px] leading-snug text-muted">
          {link?.clientName ?? "The client"} opens this link (no login) to see their work&apos;s progress, what you need from them, their Drive folder, upcoming and past payments, and download invoices. They see task names and dates only — never hours,
          times or who works on it.
        </p>
        <div className="glass rounded-2xl px-3 py-2.5 font-mono text-[12px] leading-snug text-ink [overflow-wrap:anywhere]" data-portal-url>
          {link ? link.url : error ? <span className="text-late">{error}</span> : "Loading…"}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button type="button" className={clsx(btnSecondary, "px-2 text-[14px]")} disabled={!link} onClick={copy}>
            <Copy size={15} aria-hidden /> Copy
          </button>
          <button type="button" className={clsx(btnSecondary, "px-2 text-[14px]")} disabled={!link} aria-expanded={sending} onClick={() => setSending((v) => !v)}>
            <Send size={15} aria-hidden /> Send
          </button>
          <a
            href={link?.url ?? undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!link}
            className={clsx(PREVIEW_BTN, !link && "pointer-events-none opacity-45")}
          >
            <ExternalLink size={15} aria-hidden /> Preview
          </a>
        </div>
        {sending && link ? (
          <div className="glass space-y-2 rounded-2xl p-3" role="group" aria-label="Send the link">
            <button type="button" className={clsx(btnSecondary, "w-full justify-start")} disabled={pending || !link.email} onClick={email}>
              <Mail size={16} aria-hidden /> <span className="truncate">{link.email ? `Email ${link.email}` : "No email on file"}</span>
            </button>
            <a
              href={wa ? `https://wa.me/${wa}?text=${encodeURIComponent(link.messages.whatsapp)}` : undefined}
              target="_blank"
              rel="noreferrer"
              aria-disabled={!wa}
              className={clsx(btnSecondary, "w-full justify-start", !wa && "pointer-events-none opacity-45")}
            >
              <WhatsAppIcon size={16} /> <span className="truncate">{wa ? `WhatsApp ${link.whatsapp}` : "No WhatsApp number on file"}</span>
            </a>
            {!link.email || !wa ? <p className="text-[11.5px] text-muted">Add the missing email / WhatsApp on the client (Clients › edit).</p> : null}
          </div>
        ) : null}
        <button type="button" onClick={renew} disabled={!link || pending} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted disabled:opacity-45">
          <RefreshCw size={13} aria-hidden /> New link (the old one stops working)
        </button>
      </div>
    </Sheet>
  );
}

/** A button that opens the tracking-link sheet ("Share link" on the kit page, "Tracking link" on the client form). */
export function TrackingLinkButton({ clientId, label = "Tracking link", className }: { clientId: string; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className ?? btnSecondary} onClick={() => setOpen(true)}>
        <Link2 size={15} aria-hidden /> {label}
      </button>
      {open ? <TrackingLinkSheet clientId={clientId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
