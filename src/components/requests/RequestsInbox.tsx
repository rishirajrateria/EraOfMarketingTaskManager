"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import type { RequestItem } from "@/server/requests/queries";
import type { RequestInbox } from "@/server/requests/inbox";
import { FINANCE_GROUPS, FINANCE_GROUP_LABEL, groupOfKind, inboxCounts, type FinanceGroup } from "@/server/requests/areas";
import { approveFinish, rejectFinish, resolveDoubt } from "@/server/tasks/lifecycle";
import { setTaskProtected } from "@/server/tasks/manage";
import { resolveRequest } from "@/server/requests/actions";
import type { RequestTab } from "@/server/dashboards/params";
import { useToast } from "@/components/ui/Toast";
import { Sheet } from "@/components/ui/Sheet";
import { btnPrimary, inputCls } from "@/components/ui/Field";
import { SheetButtons } from "@/components/ui/CloseX";
import { FilterRow } from "@/components/ui/FilterRow";
import { Screen } from "@/components/admin/AdminUi";
import { FinanceRow, RequestHead } from "@/components/requests/RequestCard";
import { clsx } from "@/lib/clsx";

/**
 * Admin's one requests inbox (ADR 0016, prototype `PAGES.requests`): tabs All · Finance · Work · HR in the bottom zone
 * (?tab=), finance items from the hub's "Needs you" (approve sheet, overdue invoice, Mark paid), work requests (finish,
 * doubt, review incl. per-pill review, time change, fix) and HR (leave). The primary pill row sits lowest, nearest the
 * thumb (just above the bottom nav): Finance's sub-row above the inbox tabs. The old Task list · Dashboards buttons are
 * gone — the bottom nav covers both (ADR 0016 addendum).
 */
const small = "inline-flex h-9 items-center justify-center rounded-xl px-3 text-[13px] font-semibold";
const pri = `${small} bg-primary text-primary-ink disabled:opacity-45`;
const sec = `${small} border border-hair bg-chip text-ink disabled:opacity-45`;
const sectionHead = "px-4 pb-1.5 pt-3 text-[11px] font-bold uppercase tracking-[.08em] text-muted";
const card = "mx-3 overflow-hidden rounded-[18px] border border-hair bg-glass shadow-[var(--shadow)]";

type Note = { action: "reject" | "resolve"; taskId: string };

export function RequestsInbox({ inbox, tab, fin, showAll, tz }: { inbox: RequestInbox; tab: RequestTab; fin: FinanceGroup | null; showAll: boolean; tz: string }) {
  const [note, setNote] = useState<Note | null>(null);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [navPending, startNav] = useTransition();
  const [shown, setShown] = useOptimistic({ tab, fin });
  const shownTab = shown.tab;
  const toast = useToast();
  const router = useRouter();

  const href = (t: RequestTab, all = showAll, f: FinanceGroup | null = null) => {
    const q = new URLSearchParams();
    if (t !== "ALL") q.set("tab", t);
    if (t === "FIN" && f) q.set("fin", f);
    if (all) q.set("all", "1");
    const s = q.toString();
    return `/admin/requests${s ? `?${s}` : ""}`;
  };
  const pick = (t: RequestTab, f: FinanceGroup | null) =>
    startNav(() => {
      setShown({ tab: t, fin: f });
      router.replace(href(t, showAll, f), { scroll: false });
    });

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      toast(r.ok ? "Done" : (r.error ?? "Failed"), r.ok ? "ok" : "err");
      setNote(null);
      setText("");
      router.refresh();
    });

  const open = (rows: RequestItem[]) => rows.filter((r) => r.status === "OPEN");
  const counts = inboxCounts(inbox);
  const showFin = shownTab === "ALL" || shownTab === "FIN";
  const finItems = shownTab === "FIN" && shown.fin ? inbox.finance.filter((f) => groupOfKind(f.kind) === shown.fin) : inbox.finance;
  const rows = shownTab === "WORK" ? inbox.work : shownTab === "HR" ? inbox.hr : shownTab === "ALL" ? [...inbox.work, ...inbox.hr].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [];
  const openRows = open(rows);
  const handled = rows.filter((r) => r.status !== "OPEN");
  const nothing = (!showFin || finItems.length === 0) && openRows.length === 0;

  const actions = (r: RequestItem) => {
    if (r.status !== "OPEN") return null;
    const t = r.task;
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        {r.type === "FINISH" && t ? (
          <>
            <button disabled={pending} className={pri} onClick={() => run(() => approveFinish(t.id))}>Approve</button>
            <button disabled={pending} className={sec} onClick={() => setNote({ action: "reject", taskId: t.id })}>Reject…</button>
          </>
        ) : null}
        {r.type === "DOUBT" && t ? (
          <>
            <button disabled={pending} className={pri} onClick={() => setNote({ action: "resolve", taskId: t.id })}>Unflag…</button>
            <Link href={`/dashboard?task=${t.id}`} className={sec}>Open task</Link>
          </>
        ) : null}
        {(r.type === "REVIEW" || r.type === "TIME_CHANGE") && t ? (
          <>
            <Link href={`/dashboard?task=${t.id}&edit=1`} className={pri}>Edit task</Link>
            <button disabled={pending} className={sec} onClick={() => run(() => resolveRequest(r.id, "RESOLVED"))}>Mark resolved</button>
          </>
        ) : null}
        {r.type === "FIX_SELF_TASK" && t ? (
          <>
            <button disabled={pending} className={pri} onClick={() => run(() => setTaskProtected(t.id, true))}>Protect task</button>
            <button disabled={pending} className={sec} onClick={() => run(() => resolveRequest(r.id, "REJECTED"))}>Decline</button>
          </>
        ) : null}
        {r.type === "APPROVED_CHANGE" || r.type === "LEAVE" ? (
          <Link href={r.leave ? `/requests/leave?leaveId=${r.leave.id}` : "/requests/leave"} className={pri}>Open leave</Link>
        ) : null}
      </div>
    );
  };
  const list = (items: RequestItem[]) => (
    <ul className={card}>
      {items.map((r) => (
        <li key={r.id} className={clsx("border-b border-line px-3.5 py-3 last:border-b-0", r.status !== "OPEN" && "opacity-70")}>
          <RequestHead r={r} tz={tz} />
          {actions(r)}
        </li>
      ))}
    </ul>
  );

  const label = (t: string, n: number) => (n ? `${t} · ${n}` : t);
  const zone = (
    <section className="zone-top bar-glass zone-sticky z-20 shrink-0 border-t border-hair pb-1.5 pt-1" aria-label="Requests">
      {shownTab === "FIN" ? (
        <FilterRow
          dense
          label="Finance"
          value={shown.fin}
          onChange={(f) => pick("FIN", f as FinanceGroup | null)}
          items={FINANCE_GROUPS.map((g) => ({ id: g, label: label(FINANCE_GROUP_LABEL[g], counts[g]) }))}
        />
      ) : null}
      {/* the inbox tabs sit lowest, nearest the thumb */}
      <FilterRow
        dense
        all={false}
        label="Inbox"
        value={shownTab}
        onChange={(t) => t && pick(t as RequestTab, null)}
        items={[
          { id: "ALL", label: "All" },
          { id: "FIN", label: label("Finance", counts.FIN) },
          { id: "WORK", label: label("Work", counts.WORK) },
          { id: "HR", label: label("HR", counts.HR) },
        ]}
      />
    </section>
  );

  return (
    <Screen zone={zone}>
      <div aria-busy={navPending} className={clsx("pb-4 transition-opacity", navPending && "opacity-55")}>
        <RequestsCaption />
        {showFin && finItems.length ? (
          <>
            <h2 className={sectionHead}>
              {shownTab === "FIN" && shown.fin ? FINANCE_GROUP_LABEL[shown.fin] : "Finance"} · {finItems.length}
            </h2>
            <ul className={card}>
              {finItems.map((f) => (
                <FinanceRow key={`${f.kind}-${f.id}`} item={f} />
              ))}
            </ul>
          </>
        ) : null}
        {shownTab === "FIN" && finItems.length === 0 ? (
          <p className="px-6 py-10 text-center text-[13px] text-muted">
            {shown.fin === "APPR" ? "Nothing waiting for your approval." : shown.fin === "PAY" ? "No client payments overdue." : shown.fin === "EXP" ? "No bills overdue or due this week." : "No finance approvals or reminders."}
          </p>
        ) : null}
        {shownTab !== "FIN" && openRows.length ? (
          <>
            <h2 className={sectionHead}>{shownTab === "HR" ? "Leave" : shownTab === "WORK" ? "Work" : "Work & HR"} · {openRows.length} open</h2>
            {list(openRows)}
          </>
        ) : null}
        {shownTab !== "FIN" && nothing ? <p className="px-6 py-10 text-center text-[13px] text-muted">{shownTab === "HR" ? "No leave requests." : shownTab === "WORK" ? "No work requests." : "Inbox zero."}</p> : null}
        {shownTab !== "FIN" && showAll && handled.length ? (
          <>
            <h2 className={sectionHead}>Handled</h2>
            {list(handled)}
          </>
        ) : null}
        {shownTab !== "FIN" ? (
          <div className="px-4 pt-3 text-center">
            <Link href={href(shownTab, !showAll)} replace scroll={false} className="text-[12.5px] font-semibold text-muted underline underline-offset-2">
              {showAll ? "Hide handled requests" : "Show handled requests"}
            </Link>
          </div>
        ) : null}
      </div>
      <Sheet open={!!note} onClose={() => setNote(null)} title={note?.action === "reject" ? "Reject finish" : "Resolve doubt"}>
        <div className="space-y-3 p-4">
          <textarea className={inputCls} rows={3} placeholder="Note to the team" value={text} onChange={(e) => setText(e.target.value)} />
          <SheetButtons>
            <button
              type="button"
              disabled={pending}
              className={btnPrimary}
              onClick={() => note && run(() => (note.action === "reject" ? rejectFinish(note.taskId, text) : resolveDoubt(note.taskId, text)))}
            >
              Confirm
            </button>
          </SheetButtons>
        </div>
      </Sheet>
    </Screen>
  );
}

/** Mirror of the feed's caption (ADR 0017): Requests = decisions, Notifications = updates. */
export function RequestsCaption() {
  return (
    <p className="px-4 pb-1 pt-3 text-[12.5px] leading-[1.45] text-muted">
      Waiting for your decision — approve, decline or act. Updates that need nothing from you are in{" "}
      <Link href="/notifications" className="font-bold text-ink underline underline-offset-2">
        Notifications
      </Link>
      .
    </p>
  );
}
