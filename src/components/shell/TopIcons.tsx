"use client";
import { Mail } from "lucide-react";

/**
 * Right-hand icon group of the top bar (ADR 0016 + addendum, prototype `appMail`): Gmail · Drive · WhatsApp shortcuts
 * (every role, open in a new tab). Dashboard · Requests · Notifications · Profile moved to the bottom nav row of every
 * screen, so the divider and those icons are gone. 34px buttons, 18px icons, 2px apart. Drawn on the cyan band.
 */
const ico =
  "relative flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] text-z1icon outline-none transition-colors hover:bg-white/15 focus-visible:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/80";

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

/** WhatsApp-like speech bubble with a handset (outline, follows `currentColor`); also on the task card (ADR 0017). */
export function WhatsAppIcon({ size = 18, strokeWidth = 2.1 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 21l1.6-4.6A8.5 8.5 0 1 1 7.7 19.5z" />
      <path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a3.5 3.5 0 0 1-2-2l.8-1-1-2z" />
    </svg>
  );
}

export function TopIcons({ email }: { email?: string | null }) {
  const links = shortcutLinks(email);
  return (
    <div className="flex shrink-0 items-center gap-[2px]">
      <a href={links.gmail} target="_blank" rel="noopener" aria-label="Open Gmail" title="Gmail" className={ico}>
        <Mail size={18} strokeWidth={2.1} />
      </a>
      <a href={links.drive} target="_blank" rel="noopener" aria-label="Open Google Drive" title="Google Drive" className={ico}>
        <DriveIcon />
      </a>
      <a href={links.whatsapp} target="_blank" rel="noopener" aria-label="Open WhatsApp" title="WhatsApp" className={ico}>
        <WhatsAppIcon />
      </a>
    </div>
  );
}
