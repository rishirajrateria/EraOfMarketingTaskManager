"use client";
import { formatINR, lineAmount } from "@/server/finance/money";
import { inputSm } from "@/components/finance/finance-ui";
import { emptyLine, type LineRow } from "@/components/finance/invoice-form-helpers";

const num = (s: string) => Number(s) || 0;

/** Multi-line editor: description, HSN/SAC, qty, unit HOURS | FIXED, rate. */
export function LineItemsEditor({ lines, onChange }: { lines: LineRow[]; onChange: (lines: LineRow[]) => void }) {
  const setLine = (i: number, patch: Partial<LineRow>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="glass rounded-2xl p-2">
            <input placeholder="Description" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} className={inputSm} aria-label={`Line ${i + 1} description`} />
            <div className="mt-2 grid grid-cols-4 gap-2">
              <input placeholder="HSN/SAC" value={l.hsnSac} onChange={(e) => setLine(i, { hsnSac: e.target.value })} className={inputSm} aria-label="HSN/SAC" />
              <select value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value as LineRow["unit"] })} className={inputSm} aria-label="Unit">
                <option value="FIXED">Fixed</option>
                <option value="HOURS">Hours</option>
              </select>
              <input type="number" min="0" step="0.25" placeholder="Qty" disabled={l.unit === "FIXED"} value={l.unit === "FIXED" ? "1" : l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} className={inputSm} aria-label="Quantity" />
              <input type="number" min="0" step="0.01" placeholder={l.unit === "HOURS" ? "Rate/hr" : "Amount"} value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} className={inputSm} inputMode="decimal" aria-label="Rate" />
            </div>
            <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
              <span>{formatINR(lineAmount({ qty: num(l.qty), unit: l.unit, rate: num(l.rate) }))}</span>
              {lines.length > 1 ? (
                <button type="button" className="text-red-600" onClick={() => onChange(lines.filter((_, j) => j !== i))}>remove</button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="mt-2 text-sm font-medium text-brand-blue" onClick={() => onChange([...lines, emptyLine()])}>+ Add line</button>
    </div>
  );
}
