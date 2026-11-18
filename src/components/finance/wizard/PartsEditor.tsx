"use client";
import { formatINR } from "@/server/finance/money";
import { inputSm, segActive, segIdle } from "@/components/finance/finance-ui";
import { partsSummary, shiftDateKey, type PartRow } from "@/components/finance/invoice-form-helpers";

/**
 * Part-payment rows: amount mode (% | ₹), value, due date, optional description; running total
 * "100% / ₹X allocated · ₹Y remaining" against the taxable total. Reused by the wizard and the edit-schedule sheet.
 */
export function PartsEditor({ parts, total, percentBase, onChange, firstSeq = 1, label = "Parts" }: { parts: PartRow[]; total: number; percentBase?: number; onChange: (p: PartRow[]) => void; firstSeq?: number; label?: string }) {
  const s = partsSummary(parts, total, percentBase);
  const setPart = (i: number, patch: Partial<PartRow>) => onChange(parts.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const add = () => {
    const last = parts[parts.length - 1];
    const remaining = Math.max(0, s.remaining);
    onChange([...parts, { kind: "FIXED", value: remaining > 0 ? String(remaining) : "", dueDate: last ? shiftDateKey(last.dueDate || new Date().toISOString().slice(0, 10), 30) : new Date().toISOString().slice(0, 10), description: "" }]);
  };
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-gray-600">{label}</div>
      <div className="space-y-2">
        {parts.map((p, i) => (
          <div key={i} className="glass rounded-2xl p-2">
            <div className="flex items-center gap-2">
              <span className="w-12 shrink-0 text-xs font-semibold text-gray-600">Part {firstSeq + i}</span>
              <div className="flex shrink-0 overflow-hidden rounded-lg">
                {(["PERCENT", "FIXED"] as const).map((k) => (
                  <button key={k} type="button" aria-pressed={p.kind === k} onClick={() => setPart(i, { kind: k })} className={`px-2.5 py-1 text-xs ${p.kind === k ? segActive : segIdle}`}>
                    {k === "PERCENT" ? "%" : "₹"}
                  </button>
                ))}
              </div>
              <input type="number" min="0" step="0.01" inputMode="decimal" value={p.value} onChange={(e) => setPart(i, { value: e.target.value })} className={inputSm} aria-label={`Part ${firstSeq + i} value`} placeholder={p.kind === "PERCENT" ? "%" : "₹"} />
            </div>
            <div className="mt-2 grid grid-cols-[1fr_1fr] gap-2">
              <input type="date" value={p.dueDate} onChange={(e) => setPart(i, { dueDate: e.target.value })} className={inputSm} aria-label={`Part ${firstSeq + i} due date`} />
              <input value={p.description} onChange={(e) => setPart(i, { description: e.target.value })} className={inputSm} placeholder="Description (optional)" aria-label={`Part ${firstSeq + i} description`} />
            </div>
            <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
              <span>= {formatINR(s.amounts[i] ?? 0)}</span>
              {parts.length > 1 ? (
                <button type="button" className="text-red-600" onClick={() => onChange(parts.filter((_, j) => j !== i))}>remove</button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <button type="button" className="shrink-0 whitespace-nowrap text-sm font-medium text-brand-blue" onClick={add}>+ Add part</button>
        <span className={`text-right text-xs ${s.valid ? "text-green-700" : "text-gray-600"}`}>
          {s.percent}% / {formatINR(s.allocated)} allocated · {formatINR(Math.abs(s.remaining))} {s.remaining < 0 ? "over" : "remaining"}
        </span>
      </div>
      {s.error ? <p className="mt-1 text-xs font-medium text-red-600">{s.error}</p> : null}
    </div>
  );
}
