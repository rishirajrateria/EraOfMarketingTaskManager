"use client";
import Link from "next/link";
import { BarChart3, Bell, Inbox, Mail } from "lucide-react";
import { clsx } from "@/lib/clsx";
import { Avatar } from "@/components/ui/Avatar";

/**
 * Right-hand icon group of the top bar (ADR 0016, prototype `appMail` / `.tsep`): Gmail · Drive · WhatsApp shortcuts
 * (every role, open in a new tab) | divider | Dashboards (Admin) · Requests (Admin / HR) · Notifications · avatar.
 * 34px buttons, 18px icons, 2px apart — fits 360px next to the menu button. Drawn on the cyan band.
 */
const ico = "relative flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] text-z1icon transition-colors hover:bg-white/15 focus-visible:bg-white/15";

/** Gmail / Drive open the signed-in account (`authuser`), so a second Google account in the browser isn't picked. */
export function shortcutLinks(email: string | null | undefined) {
  const q = email ? `?authuser=${encodeURIComponent(email)}` : "";
  return { gmail: `https://mail.google.com/mail/${q}`, drive: `https://drive.google.com/drive/${q}`, whatsapp: "https://wa.me/" };
}

function DriveIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8.5 3h7l6 10.5-3.5 6h-12L2.5 13.5z" />
      <path d="M8.5 3 15 14.5h6.5M2.5 13.5 9 3M6 19.5l3.5-6h12" />
    </svg>
  );
}

function WhatsAppIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 21l1.6-4.6A8.5 8.5 0 1 1 7.7 19.5z" />
      <path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a3.5 3.5 0 0 1-2-2l.8-1-1-2z" />
    </svg>
  );
}

function Count({ n }: { n: number }) {
  if (n <= 0) return null;
  return <span className="absolute right-0.5 top-0.5 min-w-[15px] rounded-full bg-red-500 px-1 text-center text-[9px] font-bold leading-[15px] text-white">{n > 99 ? "99+" : n}</span>;
}

export function TopIcons({
  user,
  requestsHref,
  requests,
  unread,
}: {
  user: { name: string; image: string | null; email?: string | null; role: string };
  /** null → no Requests icon (roles without an inbox). */
  requestsHref: string | null;
  requests: number;
  unread: number;
}) {
  const links = shortcutLinks(user.email);
  const cls = ico;
  return (
    <div className="flex shrink-0 items-center gap-[2px]">
      <a href={links.gmail} target="_blank" rel="noopener" aria-label="Open Gmail" title="Gmail" className={cls}>
        <Mail size={18} strokeWidth={2.1} />
      </a>
      <a href={links.drive} target="_blank" rel="noopener" aria-label="Open Google Drive" title="Google Drive" className={cls}>
        <DriveIcon />
      </a>
      <a href={links.whatsapp} target="_blank" rel="noopener" aria-label="Open WhatsApp" title="WhatsApp" className={cls}>
        <WhatsAppIcon />
      </a>
      <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-current text-z1icon opacity-30" />
      {user.role === "ADMIN" ? (
        <Link href="/admin/dashboards" aria-label="Dashboards" title="Dashboards" className={cls}>
          <BarChart3 size={18} strokeWidth={2.1} />
        </Link>
      ) : null}
      {requestsHref ? (
        <Link href={requestsHref} aria-label={requests ? `Requests, ${requests} open` : "Requests"} title="Requests" className={cls}>
          <Inbox size={18} strokeWidth={2.1} />
          <Count n={requests} />
        </Link>
      ) : null}
      <Link href="/notifications" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} title="Notifications" className={cls}>
        <Bell size={18} strokeWidth={2.1} />
        <Count n={unread} />
      </Link>
      <Link href="/me" aria-label="Profile" title="Profile" className={clsx(ico, "rounded-full")}>
        <span className="flex rounded-full shadow-[0_0_0_2px_rgba(255,255,255,.35)]">
          <Avatar name={user.name} src={user.image} size={24} />
        </span>
      </Link>
    </div>
  );
}
