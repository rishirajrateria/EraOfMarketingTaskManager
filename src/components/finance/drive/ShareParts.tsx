"use client";
import { useRef, useState } from "react";
import { Check, Copy, Globe, Lock } from "lucide-react";
import { btnPrimary, btnSecondary, inputCls } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";

/** Pieces shared by the Drive share sheets (Finance folders, ADR 0013; client kit, ADR 0014). */
export type Role = "reader" | "commenter" | "writer";
export const ROLES: [Role, string][] = [["reader", "Viewer"], ["commenter", "Commenter"], ["writer", "Editor"]];
export const roleLabel = (r: string) => ROLES.find(([v]) => v === r)?.[1] ?? "Owner";
const selectCls = "h-9 shrink-0 rounded-lg border border-hair bg-chip px-2 text-[13px] font-medium text-ink";
export const shareHeading = "mb-1.5 text-[10.5px] font-bold uppercase tracking-[.07em] text-muted";

export function RoleSelect({ value, onChange, disabled, label, removable }: { value: Role; onChange: (v: string) => void; disabled?: boolean; label: string; removable?: boolean }) {
  return (
    <select aria-label={label} className={selectCls} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {ROLES.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
      {removable ? (
        <>
          <option disabled>──────────</option>
          <option value="remove">Remove access</option>
        </>
      ) : null}
    </select>
  );
}

export const initial = (s: string | null | undefined) => (s ?? "?").trim().charAt(0).toUpperCase() || "?";

/** Person avatar: blue gradient with a white initial in both themes. */
export function ShareAvatar({ text, size = "md" }: { text: string | null | undefined; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "h-[26px] w-[26px] text-[12px]" : "h-8 w-8 text-[13px]";
  return <span aria-hidden className={`flex ${dim} shrink-0 items-center justify-center rounded-full bg-[linear-gradient(150deg,#60a5fa,#2563eb)] font-bold text-white`}>{initial(text)}</span>;
}

type General = { access: "restricted" | "anyone"; role: Role };

/** General access: Restricted / Anyone with the link (+ role). `inheritedLink` = opened through a parent's link. */
export function GeneralAccess({ general, disabled, onChange, inheritedLink }: { general: General; disabled?: boolean; onChange: (access: string, role: Role) => void; inheritedLink?: Role | null }) {
  const anyone = general.access === "anyone" || Boolean(inheritedLink);
  return (
    <section>
      <h3 className={shareHeading}>General access</h3>
      <div className="flex items-start gap-2.5 rounded-2xl border border-hair bg-glass px-3 py-2.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${anyone ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300" : "bg-chip text-muted"}`}>
          {anyone ? <Globe size={16} /> : <Lock size={16} />}
        </span>
        {inheritedLink ? (
          <div className="min-w-0 flex-1">
            <b className="block text-[14px] font-semibold">Anyone with the link · whole kit</b>
            <small className="block text-[12px] leading-snug text-muted">The whole kit is open to anyone with the link as {roleLabel(inheritedLink)}, so this link works too. Change it under Whole kit.</small>
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <select aria-label="General access" className="-ml-1 max-w-full bg-transparent text-[14px] font-semibold text-ink" value={general.access} disabled={disabled} onChange={(e) => onChange(e.target.value, general.role)}>
              <option value="restricted">Restricted</option>
              <option value="anyone">Anyone with the link</option>
            </select>
            <small className="block text-[12px] leading-snug text-muted">
              {general.access === "anyone" ? "Anyone on the internet with the link can open it as" : "Only people with access can open with the link"}
            </small>
            {general.access === "anyone" ? (
              <div className="mt-1.5">
                <RoleSelect label="Role for anyone with the link" value={general.role} disabled={disabled} onChange={(v) => onChange("anyone", v as Role)} />
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

/** The link box plus Copy link / Done. Falls back to selecting the link when the Clipboard API is blocked. */
export function LinkActions({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      ref.current?.focus();
      ref.current?.select();
      toast("Link selected — copy it from the box");
    }
  };
  return (
    <>
      <input ref={ref} readOnly value={url} aria-label={label} className={`${inputCls} min-h-9 py-1 text-[12px] text-muted`} onFocus={(e) => e.currentTarget.select()} />
      <div className="flex gap-2">
        <button type="button" onClick={copy} className={`${btnSecondary} min-h-11 flex-1 text-[14px]`}>
          {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Link copied" : "Copy link"}
        </button>
        <button type="button" onClick={onClose} className={`${btnPrimary} min-h-11 flex-1 text-[14px]`}>Done</button>
      </div>
    </>
  );
}

/** Notify people checkbox, optional message and Cancel / Send for the "adding people" state. */
export function SendBar({ notify, setNotify, message, setMessage, onCancel, onSend, pending, canSend }: {
  notify: boolean; setNotify: (v: boolean) => void; message: string; setMessage: (v: string) => void; onCancel: () => void; onSend: () => void; pending: boolean; canSend: boolean;
}) {
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-[14px]">
        <input type="checkbox" className="h-5 w-5 accent-brand-blue" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        <span>Notify people<small className="block text-[11.5px] text-muted">Google Drive emails them a link</small></span>
      </label>
      {notify ? <textarea rows={3} value={message} maxLength={1000} onChange={(e) => setMessage(e.target.value)} placeholder="Message (optional)" aria-label="Message" className={inputCls} /> : null}
      <div className="flex justify-end gap-2">
        <button type="button" className={`${btnSecondary} min-h-10 px-4 text-[14px]`} onClick={onCancel} disabled={pending}>Cancel</button>
        <button type="button" className={`${btnPrimary} min-h-10 px-5 text-[14px]`} onClick={onSend} disabled={pending || !canSend}>
          {pending ? "Sending…" : notify ? "Send" : "Share"}
        </button>
      </div>
    </div>
  );
}
