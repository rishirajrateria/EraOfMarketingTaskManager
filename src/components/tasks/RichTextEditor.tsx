"use client";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
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
};

const COMMANDS: { cmd: string; label: string; aria: string; cls?: string }[] = [
  { cmd: "bold", label: "B", aria: "Bold", cls: "font-bold" },
  { cmd: "italic", label: "I", aria: "Italic", cls: "italic" },
  { cmd: "insertUnorderedList", label: "•≡", aria: "Bulleted list" },
];

/** Small dependency-free contentEditable editor producing an HTML string (SPEC §6 "big description box (rich text)"). */
export const RichTextEditor = forwardRef<RichTextEditorHandle, Props>(function RichTextEditor(
  { value, onChange, placeholder = "Description…", className, minHeightClass = "min-h-32", toolbarExtra },
  ref,
) {
  const el = useRef<HTMLDivElement>(null);

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
    <div className={clsx("rounded-lg border border-gray-300 bg-white focus-within:border-brand-blue", className)}>
      <div className="flex items-center gap-1 border-b border-gray-200 px-1">
        {COMMANDS.map((c) => (
          <button
            key={c.cmd}
            type="button"
            onMouseDown={(e) => e.preventDefault()} // keep the selection inside the editor
            onClick={() => exec(c.cmd)}
            aria-label={c.aria}
            className={clsx("touch-target min-w-10 rounded px-2 text-sm text-gray-700 hover:bg-gray-100", c.cls)}
          >
            {c.label}
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
          "rte prose-sm w-full px-3 py-2 text-sm outline-none [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
          "empty:before:pointer-events-none empty:before:text-gray-400 empty:before:content-[attr(data-placeholder)]",
          minHeightClass,
        )}
      />
    </div>
  );
});
