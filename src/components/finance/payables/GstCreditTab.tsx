"use client";
import { shiftMonthKey } from "@/components/finance/finance-ui";
import { Tiles } from "@/components/finance/payables/PayablesTabs";
import { TAG, dLong, inr, monthLong, sectionHead, type Item } from "@/components/finance/payables/payables-ui";

/** Paid bills of `month` that carry GST: claimable (input tax credit) vs not. */
export function gstMonthItems(paid: Item[], month: string) {
  const inMonth = paid.filter((x) => x.occ.paidKey?.startsWith(month) && x.occ.gstAmount > 0);
  const claim = inMonth.filter((x) => x.occ.itcClaimable);
  return { inMonth, claim, notClaim: inMonth.filter((x) => !x.occ.itcClaimable), missing: claim.filter((x) => !x.occ.hasBill) };
}

/** GST credit tab (prototype): month navigator, GST you'll get back, bills attached, missing-bill warning, claimable vs not. */
export function GstCreditTab({ paid, month, onMonth, onOpen }: { paid: Item[]; month: string; onMonth: (m: string) => void; onOpen: (x: Item) => void }) {
  const { inMonth, claim, notClaim, missing } = gstMonthItems(paid, month);
  const row = (x: Item) => (
    <li key={x.occ.id} className="flex cursor-pointer items-start gap-3 px-3 py-2.5" onClick={() => onOpen(x)}>
      <div className="min-w-0 flex-1">
        <b className="block truncate text-sm">{x.bill.payee}</b>
        <small className="block truncate text-xs text-muted">{dLong(x.occ.paidKey)} · {x.occ.vendorGstin || "no GSTIN"} · bill {inr(x.occ.amount)}</small>
        <div className="mt-1">{x.occ.hasBill ? <span className={TAG.paid}>📎 {x.occ.billName || "bill"}</span> : <span className={TAG.over}>bill missing · tap to attach</span>}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-sm font-bold">{inr(x.occ.gstAmount)}</div>
        <small className="block text-[10px] text-muted">{x.occ.gstRate ?? "—"}% GST</small>
      </div>
    </li>
  );
  return (
    <>
      <div className="flex items-center gap-2 px-3 pt-3">
        <button type="button" className="glass-chip rounded-full px-3 py-1 text-sm" aria-label="Previous month" onClick={() => onMonth(shiftMonthKey(month, -1))}>‹</button>
        <b className="flex-1 text-center text-sm">{monthLong(month)}</b>
        <button type="button" className="glass-chip rounded-full px-3 py-1 text-sm" aria-label="Next month" onClick={() => onMonth(shiftMonthKey(month, 1))}>›</button>
      </div>
      <Tiles tiles={[["GST you'll get back", inr(claim.reduce((s, x) => s + x.occ.gstAmount, 0))], ["Bills attached", `${claim.length - missing.length} / ${claim.length}`, missing.length > 0]]} />
      {missing.length ? (
        <div className="mx-3 mt-3 rounded-2xl border border-hair bg-amber-100/80 px-3 py-2 text-xs text-amber-900">
          {missing.length}
          {missing.length > 1 ? " claimable bills are" : " claimable bill is"} missing. Tap to attach before sending to your finance person.
        </div>
      ) : null}
      {claim.length ? <div className={sectionHead}>Claimable · {claim.length}</div> : null}
      <ul className="divide-y divide-line">{claim.map(row)}</ul>
      {notClaim.length ? <div className={sectionHead}>GST paid, not claimable · {notClaim.length}</div> : null}
      <ul className="divide-y divide-line">{notClaim.map(row)}</ul>
      {inMonth.length ? null : <div className="px-4 py-10 text-center text-sm text-muted">No bills with GST in {monthLong(month)}. Add GST details when you mark a payment paid.</div>}
    </>
  );
}
