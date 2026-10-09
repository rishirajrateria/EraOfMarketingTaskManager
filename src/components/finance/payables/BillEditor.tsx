"use client";
import { useState } from "react";
import { BarChip, BottomZone } from "@/components/ui/BottomZone";
import { Sheet } from "@/components/ui/Sheet";
import { Field, btnDanger, btnSecondary, inputCls } from "@/components/ui/Field";
import { segActive, segIdle } from "@/components/finance/finance-ui";
import { useAction } from "@/components/finance/useAction";
import { createBill, deleteBill, updateBill } from "@/server/finance/payables";
import type { BillRow } from "@/server/finance/payables-queries";
import type { RepeatRule } from "@/server/finance/schemas";
import { describeRule, addDaysKey } from "@/server/finance/repeat";
import { CategorySelect } from "@/components/finance/payables/CategorySelect";
import { RepeatPicker } from "@/components/finance/payables/RepeatPicker";
import { METHODS, REMIND_OPTIONS, TIMING, inr, planText } from "@/components/finance/payables/payables-ui";

type Part = { v: string; due: string; note: string };
type Props = { bill: BillRow | null; categories: string[]; staff: { id: string; name: string; role: string }[]; payees: string[]; today: string };

const sec = "mb-1.5 mt-4 text-[11px] font-bold uppercase tracking-wide text-gray-500";
function Seg<T extends string | number>({ opts, cur, on }: { opts: [T, string][]; cur: T; on: (k: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {opts.map(([k, l]) => (
        <button key={String(k)} type="button" onClick={() => on(k)} className={`rounded-full px-3 py-1 text-xs font-medium ${cur === k ? segActive : segIdle}`}>{l}</button>
      ))}
    </div>
  );
}

const SALARY_RULE = (first: string): RepeatRule => ({ freq: "MONTHLY", interval: 1, weekdays: [1], monthMode: "DATE", monthDay: 32, nth: 1, nthWeekday: 1, yearMonth: 1, yearDay: 1, endsType: "NEVER", endsCount: 10, endsUntil: null, anchorDate: first });

/** Add / edit a bill (prototype `billEditor`): a page, not a sheet. The schedule freezes once a payment is recorded. */
export function BillEditor({ bill, categories: initialCats, staff, payees, today }: Props) {
  const { pending, run, router, toast } = useAction();
  const isNew = !bill;
  const hasPaid = !!bill?.occurrences.some((o) => o.status === "PAID");
  const nextDue = bill?.occurrences.find((o) => o.status === "DUE");
  const [categories, setCategories] = useState(initialCats);
  const [payee, setPayee] = useState(bill?.payee ?? "");
  const [userId, setUserId] = useState(bill?.salaryUserId ?? "");
  const [kind, setKind] = useState<"REGULAR" | "SALARY">(bill?.kind ?? "REGULAR");
  const [timing, setTiming] = useState<"PREPAID" | "POSTPAID" | "ADVANCE">(bill?.timing ?? "PREPAID");
  const [category, setCategory] = useState(bill?.category ?? initialCats[0] ?? "");
  const [note, setNote] = useState(bill?.note ?? "");
  const [plan, setPlan] = useState<"ONE_TIME" | "RECURRING" | "PART">(bill?.plan ?? "ONE_TIME");
  const [rule, setRule] = useState<RepeatRule | null>(bill?.rule ?? null);
  const [amount, setAmount] = useState(bill ? String(bill.amount) : "");
  const [remind, setRemind] = useState(bill?.remindDays ?? 1);
  const [first, setFirst] = useState(nextDue?.dueKey ?? bill?.occurrences[0]?.dueKey ?? today);
  const [already, setAlready] = useState(false);
  const [pmethod, setPmethod] = useState("UPI");
  const [partMode, setPartMode] = useState<"FIXED" | "PERCENT">("FIXED");
  const [parts, setParts] = useState<Part[]>(() =>
    bill?.plan === "PART" ? bill.occurrences.map((o) => ({ v: String(o.amount), due: o.dueKey, note: o.label?.replace(/^Part \d+ of \d+( · )?/, "") ?? "" })) : [{ v: "", due: today, note: "Advance" }, { v: "", due: addDaysKey(today, 30), note: "Balance" }],
  );
  const [picker, setPicker] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const pickKind = (k: "REGULAR" | "SALARY") => {
    setKind(k);
    if (k === "SALARY") {
      const sal = categories.find((c) => c.toLowerCase() === "salaries");
      if (sal) setCategory(sal);
      setTiming("POSTPAID");
      if (plan === "ONE_TIME" && !hasPaid) {
        setPlan("RECURRING");
        setRule((r) => r ?? SALARY_RULE(first));
      }
    }
  };
  const total = Number(amount) || 0;
  const partSum = parts.reduce((s, p) => s + (Number(p.v) || 0), 0);

  const save = () => {
    if (total <= 0) return toast("Enter the amount", "err");
    if (kind === "SALARY" ? !userId : !payee.trim()) return toast(kind === "SALARY" ? "Pick the team member" : "Who are you paying?", "err");
    if (!hasPaid && plan === "RECURRING" && !rule) return toast("Choose how often it repeats", "err");
    if (!hasPaid && plan === "PART") {
      if (parts.some((p) => !(Number(p.v) > 0) || !p.due)) return toast("Fill every part's amount and date", "err");
      if (partMode === "PERCENT" && Math.abs(partSum - 100) > 0.01) return toast("Parts must add up to 100%", "err");
      if (partMode === "FIXED" && Math.abs(partSum - total) > 0.5) return toast(`Parts must add up to ${inr(total)}`, "err");
    }
    const input = {
      payee: payee.trim(),
      kind,
      salaryUserId: kind === "SALARY" ? userId : null,
      timing,
      category,
      note,
      plan,
      amount: total,
      remindDays: remind,
      dueDate: plan === "PART" ? null : first,
      alreadyPaid: plan === "ONE_TIME" && already,
      paidMethod: pmethod,
      rule: plan === "RECURRING" && rule ? { ...rule, anchorDate: first } : null,
      partMode,
      parts: plan === "PART" ? parts.map((p) => ({ value: Number(p.v), dueDate: p.due, note: p.note })) : [],
    };
    run(
      () => (bill ? updateBill(bill.id, input) : createBill(input)),
      (d) => {
        if (d.tdsWarning) toast(d.tdsWarning, "err");
        router.push(`/admin/expenses?tab=${d.allPaid ? "PAID" : "DUE"}`);
        return isNew ? "Expense added" : "Saved";
      },
    );
  };

  let sched: React.ReactNode;
  if (hasPaid) sched = <p className="text-xs text-gray-600">Schedule: {bill ? planText(bill) : ""} · payments already recorded, so the schedule can&apos;t change. Edit the amount for future payments above.</p>;
  else if (plan === "ONE_TIME")
    sched = (
      <div className="space-y-3">
        <Field label="Due on"><input type="date" className={inputCls} value={first} onChange={(e) => setFirst(e.target.value)} /></Field>
        <label className="glass flex items-start gap-3 rounded-2xl px-3 py-2 text-sm">
          <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-blue" checked={already} onChange={(e) => setAlready(e.target.checked)} />
          <span><b className="block">Already paid</b><span className="block text-[11px] text-gray-500">Record it as paid right away</span></span>
        </label>
        {already ? <Field label="Paid by"><Seg opts={METHODS} cur={pmethod} on={setPmethod} /></Field> : null}
      </div>
    );
  else if (plan === "RECURRING")
    sched = (
      <div className="space-y-3">
        <Field label="First payment due"><input type="date" className={inputCls} value={first} onChange={(e) => setFirst(e.target.value)} /></Field>
        <button type="button" className="glass w-full rounded-2xl px-3 py-2 text-left text-sm font-semibold" onClick={() => setPicker(true)}>
          ⟳ {rule ? describeRule(rule) : "Tap to choose how often · e.g. every month on the 1st"} ›
        </button>
      </div>
    );
  else
    sched = (
      <div className="space-y-2">
        <Seg opts={[["FIXED", "Fixed ₹"], ["PERCENT", "% of total"]]} cur={partMode} on={setPartMode} />
        {parts.map((p, i) => (
          <div key={i} className="glass grid grid-cols-2 gap-2 rounded-2xl p-2">
            <input className={inputCls} type="number" placeholder={partMode === "PERCENT" ? "%" : "₹"} value={p.v} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} />
            <input className={inputCls} type="date" value={p.due} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, due: e.target.value } : x)))} />
            <input className={`${inputCls} col-span-2`} placeholder={`Part ${i + 1} note (e.g. on delivery)`} value={p.note} onChange={(e) => setParts(parts.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)))} />
            {parts.length > 1 ? <button type="button" className="col-span-2 text-right text-[11px] text-red-600" onClick={() => setParts(parts.filter((_, j) => j !== i))}>remove part</button> : null}
          </div>
        ))}
        <button type="button" className="glass-chip rounded-full px-3 py-1 text-xs" onClick={() => setParts([...parts, { v: "", due: addDaysKey(today, 60), note: "" }])}>+ add part</button>
        <p className="text-xs text-gray-600">{partMode === "PERCENT" ? `Parts add up to ${partSum}% (must be 100%).` : `Parts add up to ${inr(partSum)} of ${inr(total)}.`}</p>
      </div>
    );

  return (
    <div className="flex flex-1 flex-col">
      <div className="bg-gradient-to-br from-[#1e63d6]/90 to-[#22c3e6]/80 px-4 pb-3 pt-3 text-white backdrop-blur-xl">
        <h1 className="text-base font-semibold">{isNew ? "Add expense" : `Edit · ${bill.payee}`}</h1>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-white/55 px-4 pb-6 pt-3 backdrop-blur-md">
        <Field label="Amount (₹)" hint={plan === "RECURRING" ? "Each payment" : plan === "PART" ? "Total of all parts" : undefined}>
          <input className={`${inputCls} text-xl font-bold`} type="number" inputMode="decimal" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <div className={sec}>What is it</div>
        <Seg opts={[["REGULAR", "Regular payment"], ["SALARY", "Salary"]]} cur={kind} on={pickKind} />
        <div className="mt-3 space-y-3">
          {kind === "SALARY" ? (
            <Field label="Team member">
              <select className={inputCls} value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Pick a team member</option>
                {staff.map((u) => <option key={u.id} value={u.id}>{u.name} · {u.role.replace("_", " ").toLowerCase()}</option>)}
              </select>
            </Field>
          ) : (
            <Field label="Payee" hint="Used for the FY TDS threshold">
              <input className={inputCls} placeholder="Who are you paying? (vendor / freelancer)" list="payees" value={payee} onChange={(e) => setPayee(e.target.value)} />
            </Field>
          )}
          <Field label="Category"><CategorySelect value={category} categories={categories} onChange={setCategory} onCategories={setCategories} /></Field>
        </div>
        <div className={sec}>Paid when</div>
        <Seg opts={Object.entries(TIMING).map(([k, [l]]) => [k as typeof timing, l])} cur={timing} on={setTiming} />
        <p className="mt-1 text-[11px] text-gray-500">{TIMING[timing][1]}</p>
        <div className={sec}>Schedule</div>
        {hasPaid ? null : <Seg opts={[["ONE_TIME", "One time"], ["RECURRING", "Recurring"], ["PART", "Part payments"]]} cur={plan} on={setPlan} />}
        <div className="mt-3">{sched}</div>
        <div className={sec}>Remind me</div>
        <Seg opts={REMIND_OPTIONS} cur={remind} on={setRemind} />
        <div className="mt-3"><Field label="Note"><input className={inputCls} placeholder="What is it for?" value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
        <datalist id="payees">{payees.map((p) => <option key={p} value={p} />)}</datalist>
      </div>
      <BottomZone
        left={
          isNew ? (
            <button type="button" className="text-[12px] text-white" onClick={() => router.push("/admin/expenses")}>Cancel</button>
          ) : (
            <button type="button" className="text-[12px] font-semibold text-red-100" onClick={() => setConfirmDelete(true)}>Delete</button>
          )
        }
        right={<BarChip onClick={pending ? undefined : save} label="Save" className="font-semibold">{pending ? "Saving…" : "Save"}</BarChip>}
      />
      {picker ? <RepeatPicker init={rule} baseKey={first} title="Repeat this payment" onClose={() => setPicker(false)} onDone={(r) => { setRule(r); setPicker(false); }} /> : null}
      {confirmDelete && bill ? (
        <Sheet open onClose={() => setConfirmDelete(false)} title="Delete this bill?">
          <div className="space-y-3 px-4 py-4">
            <p className="text-sm text-gray-700">Removes {bill.payee} and all its payments from the books.</p>
            <div className="flex gap-2">
              <button type="button" className={`${btnSecondary} flex-1`} onClick={() => setConfirmDelete(false)}>Keep</button>
              <button type="button" className={`${btnDanger} flex-1`} onClick={() => run(() => deleteBill(bill.id), () => { router.push("/admin/expenses"); return "Deleted"; })}>Delete</button>
            </div>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}
