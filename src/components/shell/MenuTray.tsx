"use client";
import Link from "next/link";

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
    { href: "/admin/finance", label: "Finance sheet" },
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
    { href: "/admin/teams", label: "Add Designation" },
  ],
];

/** Flat list kept for other consumers (tests, sitemaps). */
export const MENU_ITEMS = MENU_GROUPS.flat();

export function MenuTray({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex bg-black/10" onClick={onClose}>
      <nav
        className="relative h-full w-[74%] max-w-[360px] overflow-y-auto bg-white/90 pb-24 backdrop-blur-sm"
        onClick={(e) => e.stopPropagation()}
        aria-label="Admin menu"
      >
        <Link
          href="/admin/clients?add=1"
          onClick={onClose}
          className="absolute right-3 top-2 flex flex-col items-end"
          aria-label="Add Client"
        >
          <span className="text-[38px] font-light leading-none text-gray-900">+</span>
          <span className="mt-0.5 w-[92px] text-right text-[8px] leading-[10px] text-gray-500">
            Add Client (if I add work client name visible or else not)
          </span>
        </Link>
        <ul className="px-5 pt-9">
          {MENU_GROUPS.map((group, gi) => (
            <li key={gi} className={gi === 0 ? "" : "mt-9"}>
              <ul className="space-y-1.5">
                {group.map((m) => (
                  <li key={m.href}>
                    <Link href={m.href} onClick={onClose} className="block py-1 text-[19px] leading-6 text-gray-900">
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
          className="absolute bottom-16 right-5 text-[46px] font-light leading-none text-gray-900"
          aria-label="Add task"
        >
          +
        </Link>
        <div className="absolute bottom-3 left-5 flex gap-4 text-[11px] text-gray-500">
          <Link href="/requests" onClick={onClose}>Requests</Link>
          <Link href="/admin/settings" onClick={onClose}>Settings</Link>
          <Link href="/api/auth/signout" className="text-red-600">Sign out</Link>
        </div>
      </nav>
    </div>
  );
}
