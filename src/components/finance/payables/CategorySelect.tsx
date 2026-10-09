"use client";
import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Field, btnPrimary, btnSecondary, inputCls } from "@/components/ui/Field";
import { useAction } from "@/components/finance/useAction";
import { addExpenseCategory } from "@/server/finance/payables";

/** Category select with an inline "+ New" (prototype `billEditor` cats): the new name is added to the Settings list. */
export function CategorySelect({ value, categories, onChange, onCategories }: { value: string; categories: string[]; onChange: (c: string) => void; onCategories: (list: string[]) => void }) {
  const { pending, run } = useAction();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const legacy = value && !categories.some((c) => c.toLowerCase() === value.toLowerCase()) ? value : null;
  const add = () => {
    if (!name.trim()) return;
    run(
      () => addExpenseCategory(name),
      (d) => {
        onCategories(d.categories);
        onChange(d.category);
        setAdding(false);
        setName("");
        return "Category added";
      },
      { refresh: false },
    );
  };
  return (
    <div className="flex gap-1.5">
      <select className={`${inputCls} flex-1`} value={value} onChange={(e) => onChange(e.target.value)}>
        {legacy ? <option value={legacy} disabled>{legacy} (removed)</option> : null}
        {categories.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <button type="button" className="glass-chip h-10 shrink-0 rounded-full px-3 text-xs font-medium" onClick={() => setAdding(true)}>+ New</button>
      {adding ? (
        <Sheet open onClose={() => setAdding(false)} title="New category">
          <div className="space-y-3 px-4 py-4">
            <Field label="Name" hint="Added to the list in Settings">
              <input className={inputCls} placeholder="e.g. Equipment" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
            </Field>
            <div className="flex gap-2">
              <button type="button" className={`${btnSecondary} flex-1`} onClick={() => setAdding(false)}>Cancel</button>
              <button type="button" className={`${btnPrimary} flex-1`} disabled={pending} onClick={add}>Add</button>
            </div>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}
