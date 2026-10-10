"use client";
import Link from "next/link";
import { BarChart3, Bell, Inbox } from "lucide-react";
import { clsx } from "@/lib/clsx";
import { initials } from "@/components/ui/Avatar";
import { MeetIcon } from "@/components/dashboard/GoogleIcons";
import { useLiveBadges } from "@/components/shell/useLiveBadges";
import { FAB_TONE, dashNavItems, type DashNavKey, type FabItem } from "@/components/dashboard/fab-model";
import type { TopBarUser } from "@/components/shell/TopBar";


/**
 * Last row of the task dashboard and the add-task screen (prototype `.navrow`): 64px glass with a top hairline, the
 * 52px blue square (+ / ×) pinned at the far right in the same spot on both screens.
 */
export function NavRow({ label, children, right }: { label: string; children: React.ReactNode; right: React.ReactNode }) {
  return (
    <nav aria-label={label} className="bar-glass flex h-16 shrink-0 items-center gap-1.5 border-t border-hair pl-1.5 pr-2.5">
      {children}
      {right}
    </nav>
  );
}

const itemCls =
  "relative flex h-14 min-w-12 shrink-0 flex-col items-center justify-center gap-[3px] rounded-xl px-1 text-ink outline-none focus-visible:ring-2 focus-visible:ring-[#3b82f6]";
const labCls = "whitespace-nowrap text-[10px] font-semibold leading-none text-muted";

function Badge({ n, tone }: { n: number; tone: "red" | "blue" }) {
  if (n <= 0) return null;
  return (
    <span
      aria-hidden
      className={clsx(
        "absolute left-[calc(50%+6px)] top-1 min-w-[16px] rounded-full px-1 text-center text-[9.5px] font-bold leading-4 text-white shadow-[0_0_0_2px_var(--bg)]",
        tone === "red" ? "bg-red-500" : "bg-[var(--n-blue)]",
      )}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}

const ICONS: Record<Exclude<DashNavKey, "PROFILE">, typeof Bell> = { DASHBOARD: BarChart3, REQUESTS: Inbox, NOTIFICATIONS: Bell };

/** Dashboard · Requests (red count) · Notifications (count) · Profile — sharing the width equally. */
export function DashNavItems({ user, role, unread, openRequests }: { user: TopBarUser; role: "ADMIN" | "TEAM_LEADER" | "EXECUTIVE"; unread: number; openRequests: number }) {
  const badges = useLiveBadges(user.id, unread, openRequests);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5">
      {dashNavItems(role).map((it) => {
        const n = it.key === "REQUESTS" ? badges.requests : it.key === "NOTIFICATIONS" ? badges.unread : 0;
        const Icon = it.key === "PROFILE" ? null : ICONS[it.key];
        const aria = n ? `${it.label}, ${n} ${it.key === "REQUESTS" ? "open" : "unread"}` : it.label;
        return (
          <Link key={it.key} href={it.href} aria-label={aria} title={it.label} className={clsx(itemCls, "flex-1 basis-0")}>
            <span aria-hidden className="flex h-[30px] w-[34px] items-center justify-center">
              {Icon ? (
                <Icon size={20} strokeWidth={2.1} />
              ) : (
                <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[linear-gradient(150deg,#60a5fa,#2563eb)] text-[10.5px] font-bold text-white">{initials(user.name)}</span>
              )}
            </span>
            <span aria-hidden className={labCls}>{it.label}</span>
            <Badge n={n} tone={it.key === "REQUESTS" ? "red" : "blue"} />
          </Link>
        );
      })}
    </div>
  );
}

/** One add shortcut in the add-task strip: a 32px coloured square over a tiny label. */
export function NavAddButton({ it, onPick }: { it: FabItem; onPick: (it: FabItem) => void }) {
  const Icon = it.icon;
  const name = `New ${it.label.toLowerCase()}`;
  return (
    <button type="button" onClick={() => onPick(it)} aria-label={name} title={name} className={itemCls}>
      <span aria-hidden className={clsx("flex h-8 w-8 items-center justify-center rounded-[10px]", FAB_TONE[it.tone])}>
        {Icon ? <Icon size={18} strokeWidth={2.25} /> : <MeetIcon size={20} />}
      </span>
      <span aria-hidden className={labCls}>{it.short}</span>
    </button>
  );
}
