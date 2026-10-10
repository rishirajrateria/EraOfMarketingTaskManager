"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bell, Building2, CalendarCheck, ChartLine, ChevronRight, Clock, FileText, Folder, HardDrive, Inbox, KeyRound, Layers,
  Link2, ListChecks, LogOut, Receipt, Search, Settings, Tag, UserRoundCheck, Users, Wallet, X, type LucideIcon,
} from "lucide-react";
import { menuCounts, type MenuCounts } from "@/server/shell/menu";

/**
 * Admin menu (ADR 0011): a thumb-first bottom sheet. Search on top, grouped glass sections with icons, a one-line
 * live status and badges, and quick actions pinned at the bottom where the thumb rests. Portalled to <body> so
 * blurred ancestors can never clip the fixed overlay.
 */
type Tone = "money" | "client" | "team" | "acct" | "task" | "red";
type Badge = { n: number; tone: "red" | "amber" | "soft" } | null;
type Item = { href: string; icon: LucideIcon; label: string; sub?: string; badge?: Badge; danger?: boolean };
type Section = { title: string; tone: Tone; items: Item[] };

const TONE: Record<Tone, string> = {
  money: "bg-[linear-gradient(150deg,#10b981,#059669)]",
  client: "bg-[linear-gradient(150deg,#38bdf8,#0284c7)]",
  team: "bg-[linear-gradient(150deg,#a78bfa,#7c3aed)]",
  acct: "bg-[linear-gradient(150deg,#94a3b8,#64748b)]",
  task: "bg-[linear-gradient(150deg,#22d3ee,#0891b2)]",
  red: "bg-[linear-gradient(150deg,#f87171,#dc2626)]",
};
const BADGE = {
  red: "bg-[#ef4444] text-white",
  amber: "bg-[rgba(245,158,11,.18)] text-[#b45309] dark:text-[#fcd34d]",
  soft: "bg-chip text-muted border border-hair",
} as const;

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const badge = (n: number, tone: "red" | "amber" | "soft"): Badge => (n > 0 ? { n, tone } : null);

export function menuSections(c: MenuCounts | null): Section[] {
  const k = (n: number | undefined) => n ?? 0;
  return [
    {
      title: "Money",
      tone: "money",
      items: [
        { href: "/admin/invoices", icon: FileText, label: "Invoices", sub: k(c?.invoicesToApprove) ? `${c!.invoicesToApprove} waiting for your approval` : "Create, approve and send", badge: badge(k(c?.invoicesToApprove), "red") },
        { href: "/admin/payments", icon: Wallet, label: "Payments", sub: k(c?.outstanding) ? `${inr(c!.outstanding)} outstanding` : "Nothing outstanding" },
        {
          href: "/admin/expenses",
          icon: Receipt,
          label: "Expenses",
          sub: k(c?.billsOverdue) ? `${c!.billsOverdue} overdue · ${c!.billsDueWeek} due this week` : k(c?.billsDueWeek) ? `${c!.billsDueWeek} due this week` : "Bills, GST credit, TDS",
          badge: k(c?.billsOverdue) ? badge(c!.billsOverdue, "red") : badge(k(c?.billsDueWeek), "amber"),
        },
        { href: "/admin/finance", icon: ChartLine, label: "Finance sheet", sub: k(c?.gstToClaimMonth) ? `GST to claim this month ${inr(c!.gstToClaimMonth)}` : "Totals, TDS and GST" },
        { href: "/admin/drive-folders", icon: Folder, label: "Monthly Drive folders", sub: "Invoices, bills, GST pack, cancelled" },
      ],
    },
    {
      title: "Clients",
      tone: "client",
      items: [
        { href: "/admin/clients", icon: Building2, label: "Clients", sub: `${k(c?.clients)} clients · GST, PAN, TDS` },
        { href: "/admin/vault?tab=ASSET_DRIVE_LINK", icon: Link2, label: "Asset drive links", sub: "Brand kits and source files" },
        { href: "/admin/vault?tab=CREDENTIAL", icon: KeyRound, label: "Credentials", sub: `${k(c?.credentials)} stored · encrypted` },
        { href: "/admin/vault?tab=SHARED_DRIVE_LINK", icon: HardDrive, label: "Shared drive links", sub: "Folders shared with clients" },
      ],
    },
    {
      title: "Team",
      tone: "team",
      items: [
        { href: "/attendance", icon: CalendarCheck, label: "Attendance", sub: "Mark present, half day, leave" },
        { href: "/admin/inventory", icon: Clock, label: "Inventory", sub: "Hours available vs assigned" },
        { href: "/admin/people?role=EXECUTIVE", icon: Users, label: "Executives", sub: `${k(c?.executives)} people · specialities` },
        { href: "/admin/people?role=TEAM_LEADER", icon: UserRoundCheck, label: "Team leaders", sub: "One per team" },
        { href: "/admin/teams", icon: Layers, label: "Teams", sub: c?.teams.length ? c.teams.join(", ") : "Add your first team" },
        { href: "/admin/work-types", icon: Tag, label: "Work types", sub: `${k(c?.workTypes)} types across teams` },
      ],
    },
    {
      title: "Account",
      tone: "acct",
      items: [
        { href: "/requests", icon: Inbox, label: "Requests", sub: k(c?.requestsOpen) ? `${c!.requestsOpen} open` : "Review, time change, leave", badge: badge(k(c?.requestsOpen), "red") },
        { href: "/notifications", icon: Bell, label: "Notifications", sub: k(c?.unread) ? `${c!.unread} unread` : "All caught up", badge: badge(k(c?.unread), "soft") },
        { href: "/admin/settings", icon: Settings, label: "Settings", sub: "Company, bank, invoice, TDS" },
        { href: "/api/auth/signout", icon: LogOut, label: "Sign out", danger: true },
      ],
    },
  ];
}

const QUICK: { href: string; icon: LucideIcon; label: string; tone: Tone }[] = [
  { href: "/dashboard?add=CHOOSE", icon: ListChecks, label: "New task", tone: "task" },
  { href: "/admin/invoices?new=1", icon: FileText, label: "New invoice", tone: "money" },
  { href: "/admin/expenses/new", icon: Receipt, label: "Add expense", tone: "money" },
  { href: "/admin/clients?add=1", icon: Building2, label: "Add client", tone: "client" },
];

/** Flat list kept for other consumers (tests, sitemaps). */
export const MENU_ITEMS = menuSections(null).flatMap((s) => s.items.map(({ href, label }) => ({ href, label })));

export function MenuTray({ open, onClose, user }: { open: boolean; onClose: () => void; user?: { name: string } }) {
  const [mounted, setMounted] = useState(false);
  const [q, setQ] = useState("");
  const [counts, setCounts] = useState<MenuCounts | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    setQ("");
    let live = true;
    void menuCounts().then((r) => live && r.ok && setCounts(r.data));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => {
      live = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const sections = useMemo(() => {
    const term = q.trim().toLowerCase();
    return menuSections(counts)
      .map((s) => ({ ...s, items: s.items.filter((it) => !term || `${it.label} ${it.sub ?? ""} ${s.title}`.toLowerCase().includes(term)) }))
      .filter((s) => s.items.length);
  }, [counts, q]);

  if (!open || !mounted) return null;
  const name = user?.name || "Admin";
  const initials = name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-[rgba(2,12,24,.38)] backdrop-blur-[3px]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal
        aria-label="Admin menu"
        onClick={(e) => e.stopPropagation()}
        className="sheet-up flex max-h-[92dvh] w-full max-w-[480px] flex-col rounded-t-[28px] border border-b-0 border-hair bg-sheet text-ink shadow-[0_-24px_60px_-20px_rgba(0,0,0,.5)] backdrop-blur-[30px] backdrop-saturate-[1.8]"
      >
        <div className="mx-auto mb-1.5 mt-2.5 h-[5px] w-10 shrink-0 rounded-full bg-muted opacity-35" />
        <div className="flex shrink-0 items-center gap-3 px-4 pb-3 pt-1.5">
          <span className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-[linear-gradient(150deg,#06b6d4,#2563eb)] text-[15px] font-extrabold text-white shadow-[0_8px_20px_-8px_rgba(37,99,235,.6)]">{initials}</span>
          <div className="min-w-0 flex-1">
            <b className="block truncate text-[17px] tracking-[-.015em]">{name}</b>
            <small className="block truncate text-[12px] text-muted">Admin{counts?.company ? ` · ${counts.company}` : ""}</small>
          </div>
          <Link href="/admin/settings" onClick={onClose} aria-label="Settings" className="flex h-10 w-10 items-center justify-center rounded-xl border border-hair bg-chip">
            <Settings size={18} />
          </Link>
          <button type="button" onClick={onClose} aria-label="Close menu" className="flex h-10 w-10 items-center justify-center rounded-xl border border-hair bg-chip">
            <X size={18} />
          </button>
        </div>
        <label className="mx-4 mb-2.5 flex h-11 shrink-0 items-center gap-2 rounded-[14px] border border-hair bg-input px-3.5 text-muted">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Search menu" autoComplete="off" className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none" />
        </label>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3 pt-1">
          {sections.length === 0 ? <p className="py-7 text-center text-[13px] text-muted">Nothing matches “{q}”</p> : null}
          {sections.map((s) => (
            <section key={s.title} className="mb-3.5">
              <h5 className="mx-1 mb-2 text-[11px] font-bold uppercase tracking-[.08em] text-muted">{s.title}</h5>
              <div className="overflow-hidden rounded-[18px] border border-hair bg-glass shadow-[var(--shadow)]">
                {s.items.map((it) => {
                  const Icon = it.icon;
                  return (
                    <Link
                      key={it.href}
                      href={it.href}
                      onClick={onClose}
                      className="flex min-h-14 items-center gap-3 border-b border-line px-3.5 py-2.5 last:border-b-0 active:bg-chip"
                    >
                      <span className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] text-white ${TONE[it.danger ? "red" : s.tone]}`}>
                        <Icon size={18} strokeWidth={2} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <b className={`block text-[15px] font-semibold tracking-[-.01em] ${it.danger ? "text-[#dc2626]" : ""}`}>{it.label}</b>
                        {it.sub ? <small className="mt-px block truncate text-[12px] text-muted">{it.sub}</small> : null}
                      </span>
                      {it.badge ? (
                        <span className={`inline-flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-full px-[7px] text-[11.5px] font-bold ${BADGE[it.badge.tone]}`}>{it.badge.n}</span>
                      ) : null}
                      {it.danger ? null : <ChevronRight size={16} className="shrink-0 text-muted opacity-60" />}
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        <div className="grid shrink-0 grid-cols-4 gap-2 border-t border-hair bg-glass px-4 pb-[calc(14px+env(safe-area-inset-bottom))] pt-3">
          {QUICK.map((a) => {
            const Icon = a.icon;
            return (
              <Link key={a.href} href={a.href} onClick={onClose} className="flex min-w-0 flex-col items-center gap-1.5 whitespace-nowrap rounded-2xl border border-hair bg-glass-strong px-0.5 py-2.5 text-[11px] font-semibold shadow-[var(--shadow)]">
                <span className={`flex h-[38px] w-[38px] items-center justify-center rounded-xl text-white ${TONE[a.tone]}`}>
                  <Icon size={20} />
                </span>
                {a.label}
              </Link>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
