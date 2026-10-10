"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useOptimistic, useTransition } from "react";
import { clsx } from "@/lib/clsx";
import { Screen } from "@/components/admin/AdminUi";
import { FilterRow } from "@/components/ui/FilterRow";
import {
  DASH_VIEWS, FIN_LABEL, FIN_SHOWS, PERIODS, PERIOD_LABEL, VIEW_LABEL, dashHref, effective, requestsHref, showsClients, showsTeams, tabForView,
  type DashParams,
} from "@/server/dashboards/params";

/**
 * Admin dashboards shell (ADR 0016, prototype `PAGES.insights`): caption row, the view's body, and the bottom zone —
 * the same neutral glass one-tap rows as the task dashboard (VIEW · SHOW · TEAMS · CLIENTS · WHEN) and a bar of three
 * actions. Every filter lives in the URL, so links and Back work; while the next view loads the old one stays, dimmed.
 */
type Nav = { params: DashParams; go: (patch: Partial<DashParams>) => void; pending: boolean };
const DashCtx = createContext<Nav | null>(null);

export function useDash(): Nav {
  const n = useContext(DashCtx);
  if (!n) throw new Error("useDash outside DashboardsScreen");
  return n;
}

type Named = { id: string; name: string };

const btn = "no-select relative flex h-11 min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded-[14px] px-2 text-[14px] font-semibold";
const ghost = `${btn} glass-chip border border-hair text-ink`;
const primary = `${btn} bg-gradient-to-br from-[#3b82f6] to-[#1d4ed8] text-white shadow-[0_6px_16px_-6px_rgba(37,99,235,.7)]`;

function Actions({ params, requests }: { params: DashParams; requests: number }) {
  const reqHref = requestsHref(tabForView(params.view));
  const badge = requests > 0 ? <span className="ml-0.5 inline-grid h-5 min-w-5 place-items-center rounded-full bg-[#ef4444] px-1.5 text-[11px] font-extrabold text-white">{requests}</span> : null;
  const items =
    params.view === "FIN"
      ? [
          { href: reqHref, label: "Requests", cls: ghost, extra: badge },
          { href: "/admin/invoices?new=1", label: "+ Invoice", cls: ghost },
          { href: "/admin/expenses/new", label: "+ Expense", cls: primary },
        ]
      : params.view === "HR"
        ? [
            { href: reqHref, label: "Requests", cls: ghost, extra: badge },
            { href: "/admin/inventory", label: "Inventory", cls: ghost },
            { href: "/attendance", label: "Attendance", cls: primary },
          ]
        : [
            { href: reqHref, label: "Requests", cls: ghost, extra: badge },
            { href: "/dashboard", label: "Task list", cls: ghost },
            { href: "/dashboard?add=WORK", label: "+ Task", cls: primary },
          ];
  return (
    <div className="grid h-[60px] grid-cols-3 items-center gap-2 px-3">
      {items.map((a) => (
        <Link key={a.label} href={a.href} className={a.cls} aria-label={a.label === "Requests" && requests ? `Requests, ${requests} need you` : undefined}>
          {a.label}
          {a.extra}
        </Link>
      ))}
    </div>
  );
}

export function DashboardsScreen({
  params,
  teams,
  clients,
  caption,
  requests,
  children,
}: {
  params: DashParams;
  teams: Named[];
  clients: Named[];
  caption: string;
  /** Count on the Requests button: finance items needing you / open work / open HR requests. */
  requests: number;
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
    <section className="zone-top bar-glass sticky bottom-0 z-20 shrink-0 border-t border-hair pb-[env(safe-area-inset-bottom)] pt-1" aria-label="Dashboard filters">
      <FilterRow dense all={false} label="View" items={DASH_VIEWS.map((v) => ({ id: v, label: VIEW_LABEL[v] }))} value={shown.view} onChange={(v) => v && go({ view: v as DashParams["view"] })} />
      {shown.view === "FIN" ? (
        <FilterRow dense all={false} label="Show" items={FIN_SHOWS.map((v) => ({ id: v, label: FIN_LABEL[v] }))} value={shown.fin} onChange={(v) => v && go({ fin: v as DashParams["fin"] })} />
      ) : null}
      {showsTeams(shown) ? <FilterRow dense label="Teams" items={teams.map((t) => ({ id: t.id, label: t.name }))} value={eff.team} onChange={(team) => go({ team })} /> : null}
      {showsClients(shown) ? <FilterRow dense label="Clients" items={clients.map((c) => ({ id: c.id, label: c.name }))} value={eff.client} onChange={(client) => go({ client })} /> : null}
      <FilterRow dense all={false} label="When" items={PERIODS.map((v) => ({ id: v, label: PERIOD_LABEL[v] }))} value={shown.period} onChange={(v) => v && go({ period: v as DashParams["period"] })} />
      <Actions params={shown} requests={shown.view === params.view ? requests : 0} />
    </section>
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
