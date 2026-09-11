"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Bold, Italic, List, type LucideIcon } from "lucide-react";
import { clsx } from "@/lib/clsx";

export type RichTextEditorHandle = {
  /** Append text at the end of the document (used by dictation). */
  insertText(text: string): void;
  focus(): void;
};

type Props = {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  minHeightClass?: string;
  toolbarExtra?: React.ReactNode;
  /** "dark" = the add-task look: tiny grey icon toolbar above a rounded #2A2A2A panel with a centred placeholder. */
  tone?: "light" | "dark";
};

const COMMANDS: { cmd: string; label: string; aria: string; icon: LucideIcon; cls?: string }[] = [
  { cmd: "bold", label: "B", aria: "Bold", icon: Bold, cls: "font-bold" },
  { cmd: "italic", label: "I", aria: "Italic", icon: Italic, cls: "italic" },
  { cmd: "insertUnorderedList", label: "•≡", aria: "Bulleted list", icon: List },
];

/** Small dependency-free contentEditable editor producing an HTML string (SPEC §6 "big description box (rich text)"). */
export const RichTextEditor = forwardRef<RichTextEditorHandle, Props>(function RichTextEditor(
  { value, onChange, placeholder = "Description…", className, minHeightClass = "min-h-32", toolbarExtra, tone = "light" },
  ref,
) {
  const el = useRef<HTMLDivElement>(null);
  const dark = tone === "dark";

  // Sync external value → DOM only when it actually differs (keeps the caret stable while typing).
  useEffect(() => {
    if (el.current && el.current.innerHTML !== value) el.current.innerHTML = value;
  }, [value]);

  const emit = () => onChange(el.current?.innerHTML ?? "");

  const exec = (cmd: string) => {
    el.current?.focus();
    document.execCommand(cmd, false);
    emit();
  };

  useImperativeHandle(ref, () => ({
    focus: () => el.current?.focus(),
    insertText: (text: string) => {
      const node = el.current;
      if (!node) return;
      node.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
      const needsSpace = node.textContent && !/\s$/.test(node.textContent);
      const inserted = document.execCommand("insertText", false, (needsSpace ? " " : "") + text);
      if (!inserted) node.appendChild(document.createTextNode((needsSpace ? " " : "") + text));
      emit();
    },
  }));

  return (
    <div className={clsx(dark ? "" : "rounded-lg border border-gray-300 bg-white focus-within:border-brand-blue", className)}>
      <div className={clsx("flex items-center", dark ? "mb-3 gap-3 px-2 text-[#9CA3AF]" : "gap-1 border-b border-gray-200 px-1")}>
        {COMMANDS.map((c) => (
          <button
            key={c.cmd}
            type="button"
            onMouseDown={(e) => e.preventDefault()} // keep the selection inside the editor
            onClick={() => exec(c.cmd)}
            aria-label={c.aria}
            className={clsx(
              dark ? "flex h-6 w-6 items-center justify-center rounded hover:text-white" : "touch-target min-w-10 rounded px-2 text-sm text-gray-700 hover:bg-gray-100",
              !dark && c.cls,
            )}
          >
            {dark ? <c.icon size={12} strokeWidth={2.5} aria-hidden /> : c.label}
          </button>
        ))}
        <div className="ml-auto flex items-center">{toolbarExtra}</div>
      </div>
      <div
        ref={el}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline
        aria-label="Description"
        data-placeholder={placeholder}
        onInput={emit}
        onBlur={emit}
        className={clsx(
          "rte prose-sm relative w-full outline-none [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
          "empty:before:pointer-events-none empty:before:content-[attr(data-placeholder)]",
          dark
            ? "rounded-3xl bg-[#2A2A2A] px-4 py-3 text-sm text-white empty:before:absolute empty:before:inset-0 empty:before:flex empty:before:items-center empty:before:justify-center empty:before:text-[#9CA3AF]"
            : "px-3 py-2 text-sm empty:before:text-gray-400",
          minHeightClass,
        )}
      />
    </div>
  );
});
