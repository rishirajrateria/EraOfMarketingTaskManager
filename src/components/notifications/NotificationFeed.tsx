"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { Bell, CalendarDays, Check, ChevronRight, CircleHelp, Clock, IndianRupee, Pause, Play, Plus, type LucideIcon } from "lucide-react";
import type { FeedRow, ScopeOptions } from "@/server/notification-feed";
import { markAllRead, markRead } from "@/server/notifications";
import type { FeedFilter, NotifIcon } from "@/lib/notification-kinds";
import { feedScopeHref, hasScope, toggleScopeId, type FeedScope } from "@/lib/notification-scope";
import { FilterRow } from "@/components/ui/FilterRow";
import { Screen } from "@/components/admin/AdminUi";
import { useToast } from "@/components/ui/Toast";
import { clsx } from "@/lib/clsx";

/**
 * Notifications = a feed of what happened, nothing to decide (ADR 0017, prototype `PAGES.notifications`). Rows wear the
 * colour of the task card they are about; tapping one marks it read and opens the task (or invoice / leave). Bottom
 * zone, top → bottom: TEAMS and CLIENTS ("Name · N" unread; Admin / TL / Executive only, prototype `notifTeam` /
 * `notifClient`), then SHOW All · Unread n · Tasks · People · Money lowest, nearest the thumb. Everything is in the URL
 * (?show=&team=&client=). "Mark all read" is a text link in the hint on top, only while something is unread.
 */
const ICONS: Record<NotifIcon, LucideIcon> = { play: Play, clock: Clock, check: Check, pause: Pause, help: CircleHelp, plus: Plus, calendar: CalendarDays, rupee: IndianRupee, bell: Bell };

/** The hint's text links (prototype `.linkish`): bold, underlined, with a focus ring. */
const LINKISH = "rounded-[4px] font-bold text-ink underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg)]";

const EMPTY: Record<FeedFilter, string> = {
  ALL: "No updates yet.",
  UNREAD: "You're all caught up.",
  TASKS: "No task updates.",
  PEOPLE: "No leave or people updates.",
  MONEY: "No money updates.",
};

type View = { filter: FeedFilter; scope: FeedScope };

export function NotificationFeed({
  groups,
  unread,
  filter,
  scope,
  options,
  requests,
}: {
  groups: { label: string; rows: FeedRow[] }[];
  unread: number;
  filter: FeedFilter;
  scope: FeedScope;
  /** TEAMS / CLIENTS pills (null for HR / CA: no rows). */
  options: ScopeOptions | null;
  /** Where decisions live (Admin's Requests, HR's leave inbox), or null. */
  requests: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [navPending, startNav] = useTransition();
  const [, startAction] = useTransition();
  const [view, setView] = useOptimistic<View>({ filter, scope });
  const shown = view.filter;
  const [readNow, setReadNow] = useState<ReadonlySet<string>>(() => new Set());
  const [allRead, setAllRead] = useState(false);
  // fresh rows from the server carry their own read state: drop the optimistic marks (a later update starts unread)
  const [seenGroups, setSeenGroups] = useState(groups);
  if (seenGroups !== groups) {
    setSeenGroups(groups);
    setAllRead(false);
    setReadNow(new Set());
  }
  const isRead = (r: FeedRow) => r.read || allRead || readNow.has(r.id);
  const rows = groups.flatMap((g) => g.rows);
  // only rows the server still sends as unread are subtracted, so a refresh never counts a read twice
  const unreadLeft = allRead ? 0 : Math.max(0, unread - rows.filter((r) => !r.read && readNow.has(r.id)).length);

  const go = (patch: Partial<View>) =>
    startNav(() => {
      const next = { ...view, ...patch };
      setView(next);
      router.replace(feedScopeHref(next.filter, next.scope), { scroll: false });
    });
  const pick = (f: FeedFilter) => go({ filter: f });
  const pickTeam = (id: string | null) => go({ scope: { ...view.scope, team: toggleScopeId(view.scope.team, id) } });
  const pickClient = (id: string | null) => go({ scope: { ...view.scope, client: toggleScopeId(view.scope.client, id) } });

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
    <section className="zone-top bar-glass zone-sticky z-20 shrink-0 border-t border-hair pb-1.5 pt-1" aria-label="Notifications">
      {options && options.teams.length ? (
        <FilterRow dense label="Teams" value={view.scope.team} onChange={pickTeam} items={options.teams.map((t) => ({ id: t.id, label: t.label, aria: t.unread ? `${t.name}, ${t.unread} unread` : t.name }))} />
      ) : null}
      {options && options.clients.length ? (
        <FilterRow dense label="Clients" value={view.scope.client} onChange={pickClient} items={options.clients.map((c) => ({ id: c.id, label: c.label, aria: c.unread ? `${c.name}, ${c.unread} unread` : c.name }))} />
      ) : null}
      {/* the main tabs stay lowest, nearest the thumb */}
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
    </section>
  );

  return (
    <Screen zone={zone}>
      <div aria-busy={navPending} className={clsx("pb-4 transition-opacity", navPending && "opacity-55")}>
        <p className="px-4 pb-1 pt-3 text-[12.5px] leading-[1.45] text-muted">
          Updates on tasks, people and money.
          {requests ? (
            <>
              {" "}Things that need your decision are in{" "}
              <Link href={requests} className={LINKISH}>
                Requests
              </Link>
              .
            </>
          ) : null}
          {unreadLeft > 0 ? (
            <>
              {" · "}
              <button type="button" onClick={readAll} data-mark-all className={LINKISH}>
                Mark all read
              </button>
            </>
          ) : null}
        </p>
        {rows.length === 0 ? <p className="px-6 py-10 text-center text-[13px] text-muted">{hasScope(view.scope) ? "No updates for this team or client." : EMPTY[shown]}</p> : null}
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
