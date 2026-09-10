"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Field, btnPrimary, btnSecondary, inputCls } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { computeTotals, formatINR, lineAmount } from "@/server/finance/money";
import { createInvoice } from "@/server/finance/invoices";
import { inputSm } from "@/components/finance/finance-ui";

type Line = { description: string; hsnSac: string; qty: string; unit: "HOURS" | "FIXED"; rate: string };
type ClientOpt = { id: string; name: string; email: string | null };
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const emptyLine = (): Line => ({ description: "", hsnSac: "", qty: "1", unit: "FIXED", rate: "" });

/** Payment Creator form (SPEC §11.3): line items, GST, terms, one-time/recurring, full/advance, scheduling. */
export function InvoiceForm({ clients, defaultGst, defaultTerms, onDone }: { clients: ClientOpt[]; defaultGst: number; defaultTerms: string; onDone: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [gst, setGst] = useState(String(defaultGst));
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState(defaultTerms);
  const [dueDate, setDueDate] = useState("");
  const [kind, setKind] = useState<"ONE_TIME" | "RECURRING">("ONE_TIME");
  const [freq, setFreq] = useState<"DAILY" | "WEEKLY" | "MONTHLY" | "CUSTOM">("MONTHLY");
  const [interval, setInterval] = useState("1");
  const [byWeekday, setByWeekday] = useState<number[]>([]);
  const [endDate, setEndDate] = useState("");
  const [mode, setMode] = useState<"FULL" | "ADVANCE">("FULL");
  const [advancePct, setAdvancePct] = useState("50");
  const [balanceDueOn, setBalanceDueOn] = useState("");
  const [sendAt, setSendAt] = useState("");

  const totals = useMemo(() => {
    const parsed = lines.map((l) => ({ qty: Number(l.qty) || 0, unit: l.unit, rate: Number(l.rate) || 0 }));
    const full = computeTotals(parsed, Number(gst) || 0);
    if (mode !== "ADVANCE") return full;
    const pct = Math.min(99, Math.max(1, Number(advancePct) || 50));
    return computeTotals([{ qty: 1, unit: "FIXED", rate: (full.subtotal * pct) / 100 }], Number(gst) || 0);
  }, [lines, gst, mode, advancePct]);

  function setLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  async function submit(action: "draft" | "send" | "schedule") {
    const payload = {
      clientId,
      items: lines.filter((l) => l.description.trim()).map((l) => ({ description: l.description, hsnSac: l.hsnSac || null, qty: Number(l.qty) || 1, unit: l.unit, rate: Number(l.rate) || 0 })),
      gstPercent: Number(gst),
      notes: notes || null,
      paymentTerms: terms || null,
      dueDate: dueDate || null,
      kind,
      recurrence: kind === "RECURRING" ? { frequency: freq, interval: Number(interval) || 1, byWeekday: freq === "WEEKLY" ? byWeekday : [], endDate: endDate || null } : null,
      paymentMode: mode,
      advancePercent: mode === "ADVANCE" ? Number(advancePct) : null,
      balanceDueOn: mode === "ADVANCE" && balanceDueOn ? balanceDueOn : null,
      sendAt: action === "schedule" && sendAt ? new Date(sendAt).toISOString() : null,
      sendNow: action === "send",
    };
    if (action === "schedule" && !sendAt) return toast("Pick a send date/time", "err");
    setBusy(action);
    const res = await createInvoice(payload);
    setBusy(null);
    if (!res.ok) return toast(res.error, "err");
    toast(`${res.data.number} ${res.data.status === "SENT" ? "sent" : res.data.status.toLowerCase()}`);
    onDone();
    router.push(`/admin/invoices/${res.data.id}`);
  }

  const seg = (active: boolean) => `touch-target flex-1 rounded-lg px-3 py-1.5 text-center text-sm ${active ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700"}`;

  return (
    <div className="space-y-4 px-4 py-4">
      <Field label="Client">
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={inputCls}>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.email ? "" : " (no email)"}
            </option>
          ))}
        </select>
      </Field>

      <div>
        <div className="mb-1 text-xs font-medium text-gray-600">Line items</div>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="rounded-lg border border-gray-200 p-2">
              <input placeholder="Description" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} className={inputSm} />
              <div className="mt-2 grid grid-cols-4 gap-2">
                <input placeholder="HSN/SAC" value={l.hsnSac} onChange={(e) => setLine(i, { hsnSac: e.target.value })} className={inputSm} />
                <select value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value as Line["unit"] })} className={inputSm}>
                  <option value="FIXED">Fixed</option>
                  <option value="HOURS">Hours</option>
                </select>
                <input type="number" min="0" step="0.25" placeholder="Qty" disabled={l.unit === "FIXED"} value={l.unit === "FIXED" ? "1" : l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} className={inputSm} />
                <input type="number" min="0" step="0.01" placeholder={l.unit === "HOURS" ? "Rate/hr" : "Amount"} value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} className={inputSm} inputMode="decimal" />
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
                <span>{formatINR(lineAmount({ qty: Number(l.qty) || 0, unit: l.unit, rate: Number(l.rate) || 0 }))}</span>
                {lines.length > 1 ? (
                  <button type="button" className="text-red-600" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                    remove
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <button type="button" className="mt-2 text-sm text-brand-blue" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
          + Add line
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="GST %">
          <input type="number" min="0" max="100" step="0.01" value={gst} onChange={(e) => setGst(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Due date">
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
        </Field>
      </div>

      <Field label="Invoice type">
        <div className="flex gap-2">
          <button type="button" className={seg(kind === "ONE_TIME")} onClick={() => setKind("ONE_TIME")}>One-time</button>
          <button type="button" className={seg(kind === "RECURRING")} onClick={() => setKind("RECURRING")}>Recurring</button>
        </div>
      </Field>
      {kind === "RECURRING" ? (
        <div className="space-y-2 rounded-lg bg-gray-50 p-3">
          <div className="grid grid-cols-2 gap-2">
            <select value={freq} onChange={(e) => setFreq(e.target.value as typeof freq)} className={inputSm}>
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
              <option value="MONTHLY">Monthly</option>
              <option value="CUSTOM">Custom (every N days)</option>
            </select>
            <input type="number" min="1" value={interval} onChange={(e) => setInterval(e.target.value)} className={inputSm} placeholder="Every N" />
          </div>
          {freq === "WEEKLY" ? (
            <div className="flex gap-1">
              {WEEKDAYS.map((d, i) => (
                <button key={d} type="button" onClick={() => setByWeekday((w) => (w.includes(i) ? w.filter((x) => x !== i) : [...w, i]))} className={`h-8 w-8 rounded-full text-xs ${byWeekday.includes(i) ? "bg-gray-900 text-white" : "bg-white text-gray-700 border"}`}>
                  {d}
                </button>
              ))}
            </div>
          ) : null}
          <Field label="End date" hint="leave empty for infinite">
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputSm} />
          </Field>
        </div>
      ) : null}

      <Field label="Payment type">
        <div className="flex gap-2">
          <button type="button" className={seg(mode === "FULL")} onClick={() => setMode("FULL")}>Full</button>
          <button type="button" className={seg(mode === "ADVANCE")} onClick={() => setMode("ADVANCE")}>Advance</button>
        </div>
      </Field>
      {mode === "ADVANCE" ? (
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-gray-50 p-3">
          <Field label="Advance %">
            <input type="number" min="1" max="99" value={advancePct} onChange={(e) => setAdvancePct(e.target.value)} className={inputSm} />
          </Field>
          <Field label="Balance due on" hint="empty = on completion">
            <input type="date" value={balanceDueOn} onChange={(e) => setBalanceDueOn(e.target.value)} className={inputSm} />
          </Field>
        </div>
      ) : null}

      <Field label="Payment terms">
        <textarea value={terms} onChange={(e) => setTerms(e.target.value)} className={inputCls} rows={2} />
      </Field>
      <Field label="Notes">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} rows={2} />
      </Field>
      <Field label="Schedule send (optional)">
        <input type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} className={inputCls} />
      </Field>

      <div className="rounded-lg bg-gray-900 px-4 py-3 text-white">
        <div className="flex justify-between text-xs opacity-80"><span>Subtotal</span><span>{formatINR(totals.subtotal)}</span></div>
        <div className="flex justify-between text-xs opacity-80"><span>GST {gst || 0}%</span><span>{formatINR(totals.gstAmount)}</span></div>
        <div className="mt-1 flex justify-between text-base font-bold"><span>Total{mode === "ADVANCE" ? ` (advance ${advancePct}%)` : ""}</span><span>{formatINR(totals.total)}</span></div>
      </div>

      <div className="flex flex-wrap gap-2 pb-4">
        <button type="button" disabled={!!busy} className={btnPrimary} onClick={() => submit("send")}>{busy === "send" ? "Sending…" : "Send now"}</button>
        <button type="button" disabled={!!busy} className={btnSecondary} onClick={() => submit("schedule")}>Schedule</button>
        <button type="button" disabled={!!busy} className={btnSecondary} onClick={() => submit("draft")}>Save draft</button>
      </div>
    </div>
  );
}
