"use client";
import { useRouter } from "next/navigation";
import { createContext, useContext, useOptimistic, useTransition } from "react";
import { clsx } from "@/lib/clsx";
import { Screen } from "@/components/admin/AdminUi";
import { FilterRow } from "@/components/ui/FilterRow";
import { MinimisableTray } from "@/components/dashboard/FilterTray";
import {
  DASH_VIEWS, FIN_LABEL, FIN_SHOWS, PERIODS, PERIOD_LABEL, VIEW_LABEL, dashHref, dashTrayCaption, effective, showsClients, showsTeams, type DashParams,
} from "@/server/dashboards/params";

/**
 * Admin dashboards shell (ADR 0016, prototype `PAGES.insights` / `.dview`): caption row, the view's body, and the bottom
 * zone — the same neutral glass one-tap rows as the task dashboard, top → bottom SHOW (Finance) · TEAMS · CLIENTS · WHEN
 * · VIEW (lowest, nearest the thumb, just above the bottom nav), in a tray that minimises with the task dashboard's tab
 * (MinimisableTray: a 40px bar "⌃ Filters · Finance · Overview · This month", remembered per user). The old bar of three
 * actions is gone (ADR 0016 addendum): the bottom nav and its + speed dial cover Requests / + Invoice / + Expense /
 * + Task, and the menu's Team group has Attendance and Inventory. Every filter lives in the URL, so links and Back
 * work; while the next view loads the old one stays, dimmed.
 */
type Nav = { params: DashParams; go: (patch: Partial<DashParams>) => void; pending: boolean };
const DashCtx = createContext<Nav | null>(null);

export function useDash(): Nav {
  const n = useContext(DashCtx);
  if (!n) throw new Error("useDash outside DashboardsScreen");
  return n;
}

type Named = { id: string; name: string };

export function DashboardsScreen({
  userId,
  params,
  teams,
  clients,
  caption,
  children,
}: {
  /** Whose minimised tray to remember. */
  userId: string;
  params: DashParams;
  teams: Named[];
  clients: Named[];
  caption: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [shown, setShown] = useOptimistic(params);
  const go = (patch: Partial<DashParams>) =>
    start(() => {
      setShown((p) => ({ ...p, ...patch }));
      router.push(dashHref(shown, patch), { scroll: false });
    });
  const eff = effective(shown);
  const applied = effective(params);
  const who = [applied.team ? teams.find((t) => t.id === applied.team)?.name : null, applied.client ? clients.find((c) => c.id === applied.client)?.name : null].filter(Boolean).join(" · ") || "everyone";

  const zone = (
    <MinimisableTray kind="dashboards" userId={userId} label={dashTrayCaption(shown, teams, clients)} className="zone-sticky z-20">
      <div className="zone-top bar-glass border-t border-hair pb-1.5 pt-1">
        {shown.view === "FIN" ? (
          <FilterRow dense all={false} label="Show" items={FIN_SHOWS.map((v) => ({ id: v, label: FIN_LABEL[v] }))} value={shown.fin} onChange={(v) => v && go({ fin: v as DashParams["fin"] })} />
        ) : null}
        {showsTeams(shown) ? <FilterRow dense label="Teams" items={teams.map((t) => ({ id: t.id, label: t.name }))} value={eff.team} onChange={(team) => go({ team })} /> : null}
        {showsClients(shown) ? <FilterRow dense label="Clients" items={clients.map((c) => ({ id: c.id, label: c.name }))} value={eff.client} onChange={(client) => go({ client })} /> : null}
        <FilterRow dense all={false} label="When" items={PERIODS.map((v) => ({ id: v, label: PERIOD_LABEL[v] }))} value={shown.period} onChange={(v) => v && go({ period: v as DashParams["period"] })} />
        {/* View sits lowest, nearest the thumb (just above the bottom nav) */}
        <FilterRow dense all={false} label="View" items={DASH_VIEWS.map((v) => ({ id: v, label: VIEW_LABEL[v] }))} value={shown.view} onChange={(v) => v && go({ view: v as DashParams["view"] })} />
      </div>
    </MinimisableTray>
  );

  return (
    <DashCtx.Provider value={{ params: shown, go, pending }}>
      <Screen zone={zone}>
        <div className="flex items-baseline justify-between gap-3 px-4 pb-1 pt-3 text-[11px] font-extrabold uppercase tracking-[.07em] text-muted">
          <span className="shrink-0">{caption}</span>
          <span className="min-w-0 truncate font-semibold normal-case tracking-normal" aria-live="polite">
            {pending ? "Updating…" : who}
          </span>
        </div>
        <div aria-busy={pending} className={clsx("flex flex-col gap-2.5 px-3 pb-4 pt-1.5 transition-opacity", pending && "opacity-55")}>
          {children}
        </div>
      </Screen>
    </DashCtx.Provider>
  );
}
