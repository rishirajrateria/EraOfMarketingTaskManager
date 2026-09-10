"use client";
import { useEffect, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { btnPrimary, btnSecondary, inputCls } from "@/components/ui/Field";

/** Textarea prompt used for doubt / review / time-change / reject / fix-self notes. */
export function NoteSheet({
  open,
  title,
  placeholder = "Add a note…",
  submitLabel = "Send",
  required = true,
  busy,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  placeholder?: string;
  submitLabel?: string;
  required?: boolean;
  busy?: boolean;
  onSubmit: (note: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (open) setText("");
  }, [open]);
  const disabled = busy || (required && text.trim().length === 0);
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <form
        className="space-y-3 px-4 pb-6 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!disabled) onSubmit(text.trim());
        }}
      >
        <textarea autoFocus rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} className={inputCls} maxLength={2000} />
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={btnPrimary} disabled={disabled}>
            {submitLabel}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
