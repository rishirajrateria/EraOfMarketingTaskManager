"use client";
import { useEffect, useState } from "react";
import { clsx } from "@/lib/clsx";
import type { Bar, MonthBar } from "@/server/dashboards/finance";
import { inr, inrShort, niceMax } from "@/components/dashboards/format";

/**
 * Dashboard building blocks (ADR 0016, prototype `.dbtiles` / `barList` / `incomeExpenseChart` / `.stk`): plain
 * HTML + CSS, no chart library. Values and labels wear text colours; only marks carry the series colour.
 */

export function Tiles({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-3 gap-2">{children}</div>;
}

export function Tile({ label, value, sub, alert }: { label: string; value: string; sub?: string | null; alert?: boolean }) {
  return (
    <div className="min-w-0 rounded-[14px] border border-hair bg-glass px-2 py-2 shadow-[var(--shadow)]">
      <small className="block truncate text-[10px] font-bold uppercase tracking-[.02em] text-muted" title={label}>{label}</small>
      <b className="mt-0.5 block truncate text-[16px] font-bold tabular-nums tracking-[-.01em] text-ink">{value}</b>
      {sub ? <span className={clsx("line-clamp-2 block text-[10.5px] leading-[1.3]", alert ? "font-semibold text-red-600 dark:text-red-400" : "text-muted")}>{sub}</span> : null}
    </div>
  );
}

export function Card({ title, right, children, className }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={clsx("relative rounded-[18px] border border-hair bg-glass p-3.5 shadow-[var(--shadow)]", className)} aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h4 className="text-[13.5px] font-bold tracking-[-.01em] text-ink">{title}</h4>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="pt-2 text-[13px] text-muted">{children}</p>;
}

type Tone = "inc" | "exp";
const FILL: Record<Tone, string> = { inc: "bg-s-inc", exp: "bg-s-exp" };

function Swatch({ cls }: { cls: string }) {
  return <i aria-hidden className={clsx("inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]", cls)} />;
}

/**
 * Horizontal bar list: one series, one colour, the value as text. Rows with `onPick` are buttons (tap = filter by that
 * row); the picked row is marked.
 */
export function BarList({ rows, fmt, tone = "inc", onPick, activeId, unit }: { rows: Bar[]; fmt: (n: number) => string; tone?: Tone; onPick?: (id: string) => void; activeId?: string | null; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="mt-2.5 flex flex-col gap-1">
      {rows.map((r) => {
        const body = (
          <>
            <span className="flex items-baseline justify-between gap-2 text-[13px]">
              <span className={clsx("min-w-0 truncate", activeId === r.id ? "font-bold" : "font-medium")}>
                {r.label}
                {activeId === r.id ? <span className="ml-1.5 rounded-full bg-chip px-1.5 text-[10px] font-semibold text-muted">filtered</span> : null}
              </span>
              <b className="shrink-0 tabular-nums">{fmt(r.value)}</b>
            </span>
            <span className="mt-1 block h-2 overflow-hidden rounded-full bg-chip">
              <i className={clsx("block h-full rounded-r-[4px]", FILL[tone])} style={{ width: `${Math.max(2, Math.round((r.value / max) * 100))}%` }} />
            </span>
            {r.sub ? <small className="mt-0.5 block text-[11px] text-muted">{r.sub}</small> : null}
          </>
        );
        const aria = `${r.label}: ${fmt(r.value)}${unit ? ` ${unit}` : ""}${r.sub ? `, ${r.sub}` : ""}`;
        return (
          <li key={r.id}>
            {onPick ? (
              <button type="button" onClick={() => onPick(r.id)} aria-label={`${aria}. ${activeId === r.id ? "Tap to clear the filter" : "Tap to filter"}`} aria-pressed={activeId === r.id} className="block w-full rounded-xl px-1 py-1.5 text-left active:bg-chip">
                {body}
              </button>
            ) : (
              <div aria-label={aria} className="px-1 py-1.5">
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Legend for the two-series chart (always shown). */
function IncExpLegend() {
  return (
    <div className="flex gap-3 text-[12px] text-muted">
      <span className="inline-flex items-center gap-1.5"><Swatch cls="bg-s-inc" />Income</span>
      <span className="inline-flex items-center gap-1.5"><Swatch cls="bg-s-exp" />Expense</span>
    </div>
  );
}

/**
 * Income vs expense, grouped monthly bars (two series, one axis): 4px rounded tops on the baseline, 2px between the
 * pair, a recessive mid line + baseline, ₹ axis on the left. Hover (mouse) or tap a month for the tooltip.
 */
export function IncomeExpenseChart({ months }: { months: MonthBar[] }) {
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    if (active === null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setActive(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
  const max = niceMax(Math.max(0, ...months.flatMap((m) => [m.income, m.expense])));
  const h = (v: number) => (v > 0 ? `max(2px, ${(v / max) * 100}%)` : "0");
  const n = months.length;
  const m = active === null ? null : months[active];
  const tipPos = active === null ? {} : active === 0 ? { left: 0 } : active === n - 1 ? { right: 0 } : { left: `${((active + 0.5) / n) * 100}%`, transform: "translateX(-50%)" };
  return (
    <Card title="Income vs expense" right={<IncExpLegend />}>
      <div className="mt-3 flex gap-1.5">
        <div aria-hidden className="relative h-[132px] w-[40px] shrink-0 text-right text-[10px] leading-none tabular-nums text-muted">
          <span className="absolute right-0 top-0 -translate-y-1/2">{inrShort(max)}</span>
          <span className="absolute right-0 top-1/2 -translate-y-1/2">{inrShort(max / 2)}</span>
          <span className="absolute bottom-0 right-0 translate-y-1/2">₹0</span>
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="relative h-[132px] border-b border-[var(--grid)]">
            <div className="absolute inset-x-0 top-1/2 border-t border-[var(--grid)]" />
            <div className="absolute inset-0 flex">
              {months.map((x, i) => (
                <button
                  key={x.month}
                  type="button"
                  tabIndex={0}
                  aria-label={`${x.label}: income ${inr(x.income)}, expense ${inr(x.expense)}, net ${inr(x.income - x.expense)}`}
                  aria-expanded={active === i}
                  onPointerEnter={(e) => e.pointerType === "mouse" && setActive(i)}
                  onPointerLeave={(e) => e.pointerType === "mouse" && setActive(null)}
                  onBlur={() => setActive(null)}
                  // Mouse: hover already shows it, a click keeps it. Touch / keyboard: tap toggles; tapping elsewhere blurs.
                  onClick={(e) => setActive((a) => ((e.nativeEvent as PointerEvent).pointerType === "mouse" ? i : a === i ? null : i))}
                  className={clsx("flex h-full min-w-0 flex-1 items-end justify-center gap-[2px] rounded-t-lg pt-1", active === i && "bg-chip")}
                >
                  <i className="block w-[30%] max-w-[14px] rounded-t-[4px] bg-s-inc" style={{ height: h(x.income) }} />
                  <i className="block w-[30%] max-w-[14px] rounded-t-[4px] bg-s-exp" style={{ height: h(x.expense) }} />
                </button>
              ))}
            </div>
          </div>
          <div aria-hidden className="flex pt-1">
            {months.map((x, i) => (
              <span key={x.month} className={clsx("flex-1 text-center text-[10px] leading-[14px]", active === i ? "font-bold text-ink" : "text-muted")}>
                {x.short}
              </span>
            ))}
          </div>
          {m ? (
            <div role="status" className="pointer-events-none absolute top-0 z-10 flex min-w-[150px] flex-col gap-1 rounded-xl border border-hair bg-sheet px-2.5 py-2 text-[12px] text-ink shadow-[var(--shadow-lg)] backdrop-blur-[20px]" style={tipPos}>
              <b className="text-[12.5px]">{m.label}</b>
              <span className="flex items-center gap-1.5"><Swatch cls="bg-s-inc" />Income<b className="ml-auto pl-3 tabular-nums">{inr(m.income)}</b></span>
              <span className="flex items-center gap-1.5"><Swatch cls="bg-s-exp" />Expense<b className="ml-auto pl-3 tabular-nums">{inr(m.expense)}</b></span>
              <span className="flex items-center gap-1.5 text-muted">Net<b className="ml-auto pl-3 tabular-nums">{inr(m.income - m.expense)}</b></span>
            </div>
          ) : null}
        </div>
      </div>
      {/* Screen readers also get the numbers as a table. */}
      <table className="sr-only">
        <caption>Income vs expense, last {n} months</caption>
        <thead>
          <tr><th scope="col">Month</th><th scope="col">Income</th><th scope="col">Expense</th><th scope="col">Net</th></tr>
        </thead>
        <tbody>
          {months.map((x) => (
            <tr key={x.month}><th scope="row">{x.label}</th><td>{inr(x.income)}</td><td>{inr(x.expense)}</td><td>{inr(x.income - x.expense)}</td></tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

const STATE_FILL: Record<string, string> = { green: "bg-acc-green", red: "bg-acc-red", yellow: "bg-acc-yellow", purple: "bg-[var(--acc-purple)]", white: "bg-acc-grey" };

/** Open tasks by state: one stacked bar in the card row colours (2px gaps), legend with counts, table for readers. */
export function StateBar({ segments }: { segments: { key: string; label: string; count: number }[] }) {
  const total = segments.reduce((s, x) => s + x.count, 0);
  return (
    <>
      {total ? (
        <div className="mt-2.5 flex h-3.5 gap-[2px] overflow-hidden rounded-full" aria-hidden>
          {segments.filter((s) => s.count).map((s) => (
            <i key={s.key} title={`${s.label}: ${s.count}`} className={clsx("block min-w-[4px]", STATE_FILL[s.key])} style={{ flex: s.count }} />
          ))}
        </div>
      ) : (
        <Empty>No open tasks</Empty>
      )}
      <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1.5 text-[12px] text-muted" aria-hidden>
        {segments.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <Swatch cls={STATE_FILL[s.key]} />
            {s.label} <b className="tabular-nums text-ink">{s.count}</b>
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Open tasks by state, {total} in all</caption>
        <tbody>
          {segments.map((s) => (
            <tr key={s.key}><th scope="row">{s.label}</th><td>{s.count}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
