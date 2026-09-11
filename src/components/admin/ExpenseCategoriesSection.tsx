"use client";
import { useState } from "react";
import { inputCls, btnSecondary } from "@/components/ui/Field";
import { Section, type Patch, type SettingsValues } from "@/components/admin/SettingsSections";

/**
 * Settings → Expenses: the fixed expense category list (ADR 0004). Add, rename inline, remove, reorder.
 * The list is saved with the rest of the settings form; the server de-duplicates case-insensitively.
 */
export function ExpenseCategoriesSection({ v, patch }: { v: SettingsValues; patch: Patch }) {
  const [draft, setDraft] = useState("");
  const list = v.expenseCategories;
  const exists = (name: string, except?: number) => list.some((c, i) => i !== except && c.toLowerCase() === name.toLowerCase());
  const set = (expenseCategories: string[]) => patch({ expenseCategories });

  const add = () => {
    const name = draft.trim();
    if (!name || exists(name)) return;
    set([...list, name]);
    setDraft("");
  };
  const rename = (i: number, name: string) => set(list.map((c, j) => (j === i ? name : c)));
  const remove = (i: number) => set(list.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    set(next);
  };

  return (
    <Section title="Expenses">
      <p className="text-[11px] text-gray-500">Expense categories are a fixed list — the expense form only offers these. Existing expenses keep their category even if it is removed here.</p>
      <div className="flex gap-2">
        <input
          className={inputCls}
          value={draft}
          maxLength={60}
          placeholder="New category, e.g. Travel"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className={btnSecondary} onClick={add} disabled={!draft.trim() || exists(draft.trim())}>
          Add
        </button>
      </div>
      {list.length === 0 ? (
        <p className="text-xs text-red-600">Add at least one category.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {list.map((c, i) => {
            const duplicate = c.trim() !== "" && exists(c.trim(), i);
            return (
              <li key={i} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                <input
                  className={`${inputCls} ${duplicate || !c.trim() ? "border-red-400" : ""}`}
                  aria-label={`Category ${i + 1}`}
                  value={c}
                  maxLength={60}
                  onChange={(e) => rename(i, e.target.value)}
                />
                <button type="button" className="touch-target px-1 text-gray-500 disabled:opacity-30" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button type="button" className="touch-target px-1 text-gray-500 disabled:opacity-30" aria-label="Move down" disabled={i === list.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button type="button" className="touch-target text-xs text-red-600" onClick={() => remove(i)}>
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
