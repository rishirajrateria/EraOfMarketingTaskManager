"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Admin menu tray (SPEC §11) laid out as in the "menu bar features" design: a translucent panel over the
 * dashboard with plain grouped labels, "+" (Add Client) at the top right and a large "+" at the bottom.
 */
export const MENU_GROUPS: { href: string; label: string }[][] = [
  [
    { href: "/admin/vault?tab=ASSET_DRIVE_LINK", label: "Client Assets drive Links" },
    { href: "/admin/vault?tab=CREDENTIAL", label: "Client Credentials" },
    { href: "/admin/vault?tab=SHARED_DRIVE_LINK", label: "Client shared drive links" },
  ],
  [
    { href: "/admin/expenses", label: "expense" },
    { href: "/admin/invoices", label: "PAYMENT Creator" },
    { href: "/admin/payments", label: "Payments" },
    { href: "/admin/finance", label: "Finance sheet" },
    { href: "/admin/drive-folders", label: "Monthly Drive folders" },
  ],
  [
    { href: "/attendance", label: "Attendance" },
    { href: "/admin/inventory", label: "Inventory" },
  ],
  [
    { href: "/admin/people?role=EXECUTIVE", label: "Add executive" },
    { href: "/admin/people?role=TEAM_LEADER", label: "Add teamleader" },
  ],
  [
    { href: "/admin/work-types", label: "Add Work" },
    { href: "/admin/teams", label: "Add Team" },
  ],
];

/** Flat list kept for other consumers (tests, sitemaps). */
export const MENU_ITEMS = MENU_GROUPS.flat();

export function MenuTray({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Portal to <body> so blurred/filtered ancestors can never clip the fixed overlay.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!open || !mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex bg-[rgba(2,12,24,.28)] backdrop-blur-[2px]" onClick={onClose}>
      <nav
        className="relative flex h-full w-[74%] max-w-[360px] flex-col overflow-y-auto rounded-r-[26px] border-r border-hair bg-glass-strong pb-[calc(12px+env(safe-area-inset-bottom))] text-ink shadow-[8px_0_40px_rgba(16,24,40,.15)] backdrop-blur-[30px] backdrop-saturate-[1.8]"
        onClick={(e) => e.stopPropagation()}
        aria-label="Admin menu"
      >
        <Link
          href="/admin/clients?add=1"
          onClick={onClose}
          className="absolute right-3 top-2 flex flex-col items-end"
          aria-label="Add Client"
        >
          <span className="text-[38px] font-light leading-none text-ink">+</span>
          <span className="mt-0.5 w-[84px] text-right text-[8px] leading-[10px] text-muted">
            Add Client (visible in filters once it has a task)
          </span>
        </Link>
        <ul className="px-6 pt-[calc(76px+env(safe-area-inset-top))]">
          {MENU_GROUPS.map((group, gi) => (
            <li key={gi} className={gi === 0 ? "" : "mt-7"}>
              <ul>
                {group.map((m) => (
                  <li key={m.href}>
                    <Link href={m.href} onClick={onClose} className="block py-1.5 text-[18px] leading-6 tracking-[-.01em] text-ink">
                      {m.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <Link
          href="/dashboard?add=CHOOSE"
          onClick={onClose}
          className="mr-6 mt-9 self-end text-[46px] font-light leading-none text-ink"
          aria-label="Add task"
        >
          +
        </Link>
        <div className="mt-auto flex gap-4 px-6 pt-5 text-[11px] text-muted">
          <Link href="/requests" onClick={onClose}>Requests</Link>
          <Link href="/admin/settings" onClick={onClose}>Settings</Link>
          <Link href="/api/auth/signout" className="text-red-600">Sign out</Link>
        </div>
      </nav>
    </div>
    ,
    document.body,
  );
}
