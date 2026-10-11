import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, Download, ExternalLink, FolderOpen } from "lucide-react";
import { portalData, type PortalMoney, type PortalTask } from "@/server/portal/portal";

export const dynamic = "force-dynamic";

/** Never indexed, and the token never leaks to Google Drive through the Referer header. */
export const metadata: Metadata = { title: "Your work · tracking", robots: { index: false, follow: false, nocache: true }, referrer: "no-referrer" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-13" → "13 Oct" (+ the year when it is not this year). */
function fmtDay(key: string | null, thisYear: number): string {
  if (!key) return "—";
  const [y, m, d] = key.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}${y === thisYear ? "" : ` ${y}`}`;
}

const TONE_TEXT: Record<PortalTask["tone"], string> = {
  white: "text-ink",
  green: "text-ontime",
  yellow: "text-[#b45309] dark:text-[#fcd34d]",
  red: "text-late",
  purple: "text-[#6d28d9] dark:text-[#c4b5fd]",
  grey: "text-muted",
};

function Heading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-1.5 mt-5 px-1 text-[11px] font-bold uppercase tracking-[.08em] text-muted">{children}</h2>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-hair bg-glass px-4 py-4 text-center text-[13px] text-muted">{children}</p>;
}

function TaskList({ tasks, ask, year }: { tasks: PortalTask[]; ask?: boolean; year: number }) {
  return (
    <ul className="-mx-2.5">
      {tasks.map((t, i) => (
        <li key={i} className={`task-card row-${t.tone}`} data-portal-task>
          <b className={`block text-[15px] font-[650] leading-5 tracking-[-.01em] text-ink ${t.tone === "grey" ? "line-through" : ""}`}>{t.title}</b>
          <div className="mt-1.5 flex min-w-0 items-center justify-between gap-2">
            <span className={`glass-chip inline-block h-[22px] min-w-0 truncate rounded-full px-[9px] text-[11.5px] font-semibold leading-[22px] ${TONE_TEXT[t.tone]}`}>{t.status}</span>
            <span className={`glass-chip inline-flex h-6 shrink-0 items-center rounded-full px-[9px] text-[11.5px] font-medium tabular-nums ${t.tone === "red" ? "text-late" : "text-ink"}`}>
              {ask ? "Needed by" : "Due"} {fmtDay(t.due, year)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function MoneyRow({ m, token, kind, year }: { m: PortalMoney; token: string; kind: "due" | "paid"; year: number }) {
  return (
    <li className="flex items-center gap-2.5 border-b border-line px-3 py-2.5 last:border-b-0" data-portal-invoice>
      <span className="min-w-0 flex-1">
        <b className="block text-[14px] font-semibold leading-snug text-ink [overflow-wrap:anywhere]">{m.label}</b>
        <small className={`block truncate text-[11.5px] ${m.overdue ? "font-semibold text-late" : "text-muted"}`}>
          {kind === "paid" ? `Paid · ${fmtDay(m.date, year)}` : m.date ? `${m.overdue ? "Overdue · was due" : "Due"} ${fmtDay(m.date, year)}` : "Due on receipt"}
        </small>
      </span>
      <span className={`shrink-0 text-[14px] font-bold tabular-nums ${m.overdue ? "text-late" : "text-ink"}`}>{m.amount}</span>
      <a
        href={`/c/${token}/invoice/${m.id}`}
        className="glass-chip inline-flex h-[30px] shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold text-ink"
        aria-label={`Download ${m.label} (PDF)`}
      >
        PDF <Download size={13} aria-hidden />
      </a>
    </li>
  );
}

/**
 * The client's tracking page (prototype `PAGES.portal`): public, no login, mobile-first glass, light / dark from the
 * system. Only the client's own name, work titles + status words + due days, what we need from them, their kit's Drive
 * folder and issued invoices — never hours, times, staff, notes or anything of another client.
 */
export default async function ClientTrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const d = await portalData(token);
  if (!d) notFound();
  const year = new Date().getFullYear();
  const pct = d.progress.total ? Math.round((d.progress.done / d.progress.total) * 100) : 0;
  const open = d.progress.total - d.progress.done;
  return (
    <main className="mx-auto min-h-dvh w-full max-w-[480px] px-4 pb-10 pt-[calc(14px+env(safe-area-inset-top))] text-ink">
      <header className="bg-cyan-area -mx-4 -mt-[calc(14px+env(safe-area-inset-top))] px-5 pb-5 pt-[calc(18px+env(safe-area-inset-top))] text-[var(--z1ink)]">
        <p className="text-[11px] font-bold uppercase tracking-[.1em] opacity-75">{d.company.name} · your work</p>
        <h1 className="mt-1 text-[24px] font-bold leading-tight tracking-[-.02em] [overflow-wrap:anywhere]">{d.clientName}</h1>
      </header>

      <section className="glass mt-4 rounded-[18px] px-4 py-3" aria-label="Work in progress">
        <h2 className="text-[13px] font-bold">Work in progress</h2>
        <div className="mt-1 flex items-baseline justify-between text-[13px]">
          <span>
            <b className="text-[18px] tabular-nums">{d.progress.done}</b> of <b className="tabular-nums">{d.progress.total}</b> done
          </span>
          <span className="text-muted">{open} open</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-chip" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`${d.progress.done} of ${d.progress.total} done`}>
          <div className="h-full rounded-full bg-[linear-gradient(90deg,#34d399,#059669)]" style={{ width: `${pct}%` }} />
        </div>
      </section>

      {d.asks.length ? (
        <>
          <Heading>Things we need from you</Heading>
          <TaskList tasks={d.asks} ask year={year} />
        </>
      ) : null}

      <Heading>Your work</Heading>
      {d.work.length ? <TaskList tasks={d.work} year={year} /> : <Empty>Nothing in progress right now.</Empty>}

      {d.finished.length ? (
        <>
          <Heading>Done</Heading>
          <TaskList tasks={d.finished} year={year} />
        </>
      ) : null}

      <Heading>Files</Heading>
      {d.driveUrl ? (
        <a href={d.driveUrl} target="_blank" rel="noreferrer noopener" className="glass flex items-center gap-3 rounded-[18px] px-3 py-3 active:opacity-80">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-[linear-gradient(150deg,#38bdf8,#0284c7)] text-white">
            <FolderOpen size={18} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <b className="block text-[14px] font-semibold">Open your Drive folder</b>
            <small className="block text-[11.5px] text-muted">Your brand kit, credentials sheet, work and reports</small>
          </span>
          <ExternalLink size={15} className="shrink-0 text-muted" aria-hidden />
        </a>
      ) : (
        <div className="glass flex items-center gap-3 rounded-[18px] px-3 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-chip text-muted">
            <FolderOpen size={18} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <b className="block text-[14px] font-semibold">Your Drive folder is being set up</b>
            <small className="block text-[11.5px] text-muted">We&apos;ll add it to this page</small>
          </span>
        </div>
      )}

      <Heading>Upcoming payments</Heading>
      {d.upcoming.length ? (
        <ul className="glass overflow-hidden rounded-[18px]">
          {d.upcoming.map((m) => (
            <MoneyRow key={m.id} m={m} token={token} kind="due" year={year} />
          ))}
        </ul>
      ) : (
        <p className="glass flex items-center justify-center gap-1.5 rounded-[18px] px-4 py-3 text-[13px] text-muted">
          <CheckCircle2 size={15} className="text-ontime" aria-hidden /> Nothing due. Thank you!
        </p>
      )}

      <Heading>Last payments</Heading>
      {d.paid.length ? (
        <ul className="glass overflow-hidden rounded-[18px]">
          {d.paid.map((m) => (
            <MoneyRow key={m.id} m={m} token={token} kind="paid" year={year} />
          ))}
        </ul>
      ) : (
        <Empty>No payments yet.</Empty>
      )}

      <footer className="mt-6 px-1 text-center text-[12px] leading-relaxed text-muted [overflow-wrap:anywhere]">
        {[d.company.name, d.company.email, d.company.phone].filter(Boolean).join(" · ")}
      </footer>
    </main>
  );
}
