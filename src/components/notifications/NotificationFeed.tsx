"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { Bell, CalendarDays, Check, ChevronRight, CircleHelp, Clock, IndianRupee, Pause, Play, Plus, type LucideIcon } from "lucide-react";
import type { FeedRow } from "@/server/notification-feed";
import { markAllRead, markRead } from "@/server/notifications";
import { feedHref, type FeedFilter, type NotifIcon } from "@/lib/notification-kinds";
import { FilterRow } from "@/components/ui/FilterRow";
import { Screen } from "@/components/admin/AdminUi";
import { useToast } from "@/components/ui/Toast";
import { clsx } from "@/lib/clsx";

/**
 * Notifications = a feed of what happened, nothing to decide (ADR 0017, prototype `PAGES.notifications`). Rows wear the
 * colour of the task card they are about; tapping one marks it read and opens the task (or invoice / leave). Bottom
 * zone: SHOW All · Unread n · Tasks · People · Money (?show=) and Mark all read · Task list.
 */
const ICONS: Record<NotifIcon, LucideIcon> = { play: Play, clock: Clock, check: Check, pause: Pause, help: CircleHelp, plus: Plus, calendar: CalendarDays, rupee: IndianRupee, bell: Bell };

const EMPTY: Record<FeedFilter, string> = {
  ALL: "No updates yet.",
  UNREAD: "You're all caught up.",
  TASKS: "No task updates.",
  PEOPLE: "No leave or people updates.",
  MONEY: "No money updates.",
};

export type FeedLinks = { requests: string | null; home: { href: string; label: string } };

export function NotificationFeed({ groups, unread, filter, links }: { groups: { label: string; rows: FeedRow[] }[]; unread: number; filter: FeedFilter; links: FeedLinks }) {
  const router = useRouter();
  const toast = useToast();
  const [navPending, startNav] = useTransition();
  const [, startAction] = useTransition();
  const [shown, setShown] = useOptimistic(filter);
  const [readNow, setReadNow] = useState<ReadonlySet<string>>(() => new Set());
  const [allRead, setAllRead] = useState(false);
  const isRead = (r: FeedRow) => r.read || allRead || readNow.has(r.id);
  const unreadLeft = allRead ? 0 : Math.max(0, unread - readNow.size);

  const pick = (f: FeedFilter) =>
    startNav(() => {
      setShown(f);
      router.replace(feedHref(f), { scroll: false });
    });

  const open = (r: FeedRow) => {
    const wasRead = isRead(r);
    if (!wasRead) setReadNow((s) => new Set(s).add(r.id));
    startAction(async () => {
      if (!wasRead) await markRead(r.id);
      if (r.target) router.push(r.target);
      else router.refresh();
    });
  };

  const readAll = () =>
    startAction(async () => {
      setAllRead(true);
      const res = await markAllRead();
      if (!res.ok) {
        setAllRead(false);
        toast(res.error, "err");
      }
      router.refresh();
    });

  const zone = (
    <section className="zone-top bar-glass zone-sticky z-20 shrink-0 border-t border-hair pt-1" aria-label="Notifications">
      <FilterRow
        dense
        all={false}
        label="Show"
        value={shown}
        onChange={(f) => f && pick(f as FeedFilter)}
        items={[
          { id: "ALL", label: "All" },
          { id: "UNREAD", label: unreadLeft ? `Unread · ${unreadLeft}` : "Unread" },
          { id: "TASKS", label: "Tasks" },
          { id: "PEOPLE", label: "People" },
          { id: "MONEY", label: "Money" },
        ]}
      />
      <div className="grid h-[60px] grid-cols-2 items-center gap-2 px-3">
        <button
          type="button"
          onClick={readAll}
          disabled={unreadLeft === 0}
          className="glass-chip flex h-11 items-center justify-center rounded-[14px] border border-hair text-[14px] font-semibold text-ink disabled:opacity-50"
        >
          Mark all read
        </button>
        <Link
          href={links.home.href}
          className="flex h-11 items-center justify-center rounded-[14px] bg-gradient-to-br from-[#3b82f6] to-[#1d4ed8] text-[14px] font-semibold text-white shadow-[0_6px_16px_-6px_rgba(37,99,235,.7)]"
        >
          {links.home.label}
        </Link>
      </div>
    </section>
  );

  const rows = groups.flatMap((g) => g.rows);
  return (
    <Screen zone={zone}>
      <div aria-busy={navPending} className={clsx("pb-4 transition-opacity", navPending && "opacity-55")}>
        <p className="px-4 pb-1 pt-3 text-[12.5px] leading-[1.45] text-muted">
          Updates on tasks, people and money.
          {links.requests ? (
            <>
              {" "}Things that need your decision are in{" "}
              <Link href={links.requests} className="font-bold text-ink underline underline-offset-2">
                Requests
              </Link>
              .
            </>
          ) : null}
        </p>
        {rows.length === 0 ? <p className="px-6 py-10 text-center text-[13px] text-muted">{EMPTY[shown]}</p> : null}
        {groups.map((g) => (
          <section key={g.label} aria-label={g.label}>
            <h2 className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-[.08em] text-muted">{g.label}</h2>
            <ul>
              {g.rows.map((r) => (
                <FeedItem key={r.id} r={r} read={isRead(r)} onOpen={() => open(r)} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Screen>
  );
}

function FeedItem({ r, read, onOpen }: { r: FeedRow; read: boolean; onOpen: () => void }) {
  const Icon = ICONS[r.icon];
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        data-kind={r.kind}
        aria-label={`${r.headline}${r.phrase ? `. ${r.phrase}` : ""}. ${r.meta}${read ? "" : ". Unread"}`}
        className={clsx(
          "nrow relative mx-2.5 flex w-[calc(100%-20px)] items-center gap-3 rounded-l-[10px] border-b border-line py-[9px] pl-3 pr-2.5 text-left text-ink transition-colors hover:bg-chip",
          `n-${r.tone}`,
          read && "opacity-[.62]",
        )}
      >
        <span className="nic grid h-8 w-8 shrink-0 place-items-center rounded-full" aria-hidden>
          <Icon size={16} strokeWidth={2.4} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <b className={clsx("truncate text-[13.5px] leading-[1.35]", read ? "font-medium" : "font-semibold")}>{r.headline}</b>
          {r.phrase ? <span className="line-clamp-2 text-[13px] leading-[1.35] text-ink">{r.phrase}</span> : null}
          <small className="truncate text-[11.5px] text-muted">{r.meta}</small>
        </span>
        {read ? null : <i className="h-2 w-2 shrink-0 rounded-full bg-[var(--n-blue)]" aria-hidden data-unread-dot />}
        {r.target ? <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden /> : null}
      </button>
    </li>
  );
}
