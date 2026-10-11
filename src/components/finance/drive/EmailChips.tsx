"use client";
import { useState } from "react";
import { X } from "lucide-react";

/** Loose client-side check; the server validates again with zod. */
export const isEmail = (s: string) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(s);

/**
 * "Add people" field of the Share sheet: typed emails become chips on Enter, comma, space, semicolon or blur, and a
 * pasted list is split. Invalid addresses stay as red chips so the owner can see and remove them.
 */
export function EmailChips({ value, onChange, disabled }: { value: string[]; onChange: (emails: string[]) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState("");

  const commit = (text: string) => {
    const parts = text.split(/[\s,;]+/).map((p) => p.trim().toLowerCase()).filter(Boolean);
    if (parts.length) onChange(Array.from(new Set([...value, ...parts])));
    setDraft("");
  };

  return (
    <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-hair bg-input px-2 py-1.5 shadow-[inset_0_1px_2px_rgba(15,40,70,.06)]">
      {value.map((e) => {
        const ok = isEmail(e);
        return (
          <span
            key={e}
            className={`inline-flex max-w-full items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-[13px] ${ok ? "border-hair bg-chip text-ink" : "border-red-400/60 bg-red-500/10 text-red-700 dark:text-red-300"}`}
            title={ok ? e : `${e} is not a valid email`}
          >
            <span className="truncate">{e}</span>
            <button type="button" aria-label={`Remove ${e}`} onClick={() => onChange(value.filter((x) => x !== e))} className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted active:bg-chip">
              <X size={12} />
            </button>
          </span>
        );
      })}
      <input
        // type="text": an email input strips the trailing space, so "space adds a chip" would never fire.
        type="text"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        aria-label="Add people by email"
        placeholder={value.length ? "" : "Add people by email"}
        value={draft}
        disabled={disabled}
        onChange={(e) => {
          const v = e.target.value;
          if (/[\s,;]$/.test(v)) commit(v);
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          if (/[\s,;]/.test(text.trim())) {
            e.preventDefault();
            commit(`${draft} ${text}`);
          }
        }}
        onBlur={() => draft && commit(draft)}
        className="min-w-[8rem] flex-1 bg-transparent px-1 text-[15px] text-ink outline-none placeholder:text-muted"
      />
    </div>
  );
}
