"use client";
import Link from "next/link";

/** Admin menu tray (SPEC §11) — order follows the "menu bar features" design. */
export const MENU_ITEMS: { href: string; label: string; icon: string }[] = [
  { href: "/", label: "Dashboard", icon: "🗂" },
  { href: "/admin/vault", label: "Client Assets Drive Links", icon: "🔗" },
  { href: "/admin/vault?tab=CREDENTIAL", label: "Client Credentials", icon: "🔐" },
  { href: "/admin/vault?tab=SHARED_DRIVE_LINK", label: "Client Shared Drive Links", icon: "📁" },
  { href: "/admin/expenses", label: "Expense", icon: "🧾" },
  { href: "/admin/invoices", label: "Payment Creator", icon: "💳" },
  { href: "/admin/finance", label: "Finance sheet", icon: "📊" },
  { href: "/attendance", label: "Attendance", icon: "🗓" },
  { href: "/admin/inventory", label: "Inventory", icon: "⏱" },
  { href: "/admin/people?role=EXECUTIVE", label: "Add Executive", icon: "👤" },
  { href: "/admin/people?role=TEAM_LEADER", label: "Add Team Leader", icon: "👥" },
  { href: "/admin/work-types", label: "Add Work", icon: "🏷" },
  { href: "/admin/teams", label: "Add Designation", icon: "🏢" },
  { href: "/requests", label: "Requests", icon: "📥" },
  { href: "/admin/settings", label: "Settings", icon: "⚙️" },
];

export function MenuTray({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex bg-black/40" onClick={onClose}>
      <nav className="h-full w-72 max-w-[85%] overflow-y-auto bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="bg-brand-blue-dark px-4 py-4 text-white">
          <div className="text-lg font-bold">Menu</div>
          <div className="text-xs text-white/70">Admin back-office</div>
        </div>
        <ul className="py-2">
          {MENU_ITEMS.map((m) => (
            <li key={m.href}>
              <Link href={m.href} onClick={onClose} className="touch-target flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-gray-100">
                <span className="w-6 text-center">{m.icon}</span>
                <span>{m.label}</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="border-t px-4 py-3">
          <Link href="/api/auth/signout" className="text-sm text-red-600">
            Sign out
          </Link>
        </div>
      </nav>
    </div>
  );
}
