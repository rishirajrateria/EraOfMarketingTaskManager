"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Copy, Globe, Lock, Share2 } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { btnPrimary, btnSecondary, inputCls } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { changeShareRole, getFolderSharing, removeShareAccess, setGeneralAccess, shareFolder } from "@/server/finance/drive-share";
import type { FolderSharing } from "@/server/finance/drive-share-core";
import type { ActionResult } from "@/lib/action-result";
import { EmailChips, isEmail } from "@/components/finance/drive/EmailChips";

/**
 * Share sheet for a Finance / month folder (ADR 0013), laid out like Google Drive's share dialog: Add people (chips +
 * role + Notify people + message), People with access (owner fixed; others change role or lose access), General
 * access (Restricted / Anyone with the link + role) and Copy link.
 */
type Role = "reader" | "commenter" | "writer";
const ROLES: [Role, string][] = [["reader", "Viewer"], ["commenter", "Commenter"], ["writer", "Editor"]];
const selectCls = "h-9 shrink-0 rounded-lg border border-hair bg-chip px-2 text-[13px] font-medium text-ink";

function RoleSelect({ value, onChange, disabled, label, extra }: { value: Role; onChange: (v: string) => void; disabled?: boolean; label: string; extra?: React.ReactNode }) {
  return (
    <select aria-label={label} className={selectCls} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {ROLES.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
      {extra}
    </select>
  );
}

const initial = (s: string | null) => (s ?? "?").trim().charAt(0).toUpperCase() || "?";

export function DriveShareSheet({ folderId, title, open, onClose }: { folderId: string; title: string; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<FolderSharing | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [emails, setEmails] = useState<string[]>([]);
  const [role, setRole] = useState<Role>("reader");
  const [notify, setNotify] = useState(true);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const linkRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setData(null);
    setLoadError(null);
    void getFolderSharing(folderId).then((r) => {
      if (!live) return;
      if (r.ok) setData(r.data);
      else setLoadError(r.error);
    });
    return () => {
      live = false;
    };
  }, [open, folderId]);

  const apply = (call: () => Promise<ActionResult<FolderSharing>>, done?: string) =>
    start(async () => {
      const r = await call();
      if (!r.ok) return toast(r.error, "err");
      setData(r.data);
      if (done) toast(done);
    });

  const invalid = emails.filter((e) => !isEmail(e));
  const send = () =>
    start(async () => {
      if (invalid.length) return toast(`Check ${invalid.join(", ")}`, "err");
      const r = await shareFolder(folderId, { emails, role, notify, message: notify && message.trim() ? message.trim() : null });
      if (!r.ok) return toast(r.error, "err");
      setData(r.data.sharing);
      setEmails([]);
      setMessage("");
      const failed = r.data.failed.length ? ` · could not add ${r.data.failed.map((f) => f.email).join(", ")}` : "";
      toast(`Shared with ${r.data.added.length} ${r.data.added.length === 1 ? "person" : "people"}${failed}`);
    });

  const copyLink = async () => {
    const url = data?.url ?? "";
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API blocked (http, old WebView): select the visible link so the owner can copy it by hand.
      linkRef.current?.focus();
      linkRef.current?.select();
      toast("Link selected — copy it from the box");
    }
  };

  const adding = emails.length > 0;
  return (
    <Sheet open={open} onClose={onClose} title={`Share “${title}”`}>
      <div className="space-y-4 px-4 pb-5">
        <section className="space-y-2">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <EmailChips value={emails} onChange={setEmails} disabled={pending} />
            </div>
            {adding ? <RoleSelect label="Role for new people" value={role} onChange={(v) => setRole(v as Role)} /> : null}
          </div>
          {adding ? (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-[14px]">
                <input type="checkbox" className="h-5 w-5 accent-brand-blue" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
                Notify people
              </label>
              {notify ? <textarea rows={3} value={message} maxLength={1000} onChange={(e) => setMessage(e.target.value)} placeholder="Message (optional)" className={inputCls} /> : null}
              <div className="flex justify-end gap-2">
                <button type="button" className={`${btnSecondary} min-h-10 px-4 text-[14px]`} onClick={() => setEmails([])} disabled={pending}>Cancel</button>
                <button type="button" className={`${btnPrimary} min-h-10 px-5 text-[14px]`} onClick={send} disabled={pending || invalid.length > 0}>
                  {pending ? "Sending…" : notify ? "Send" : "Share"}
                </button>
              </div>
            </div>
          ) : null}
        </section>

        {loadError ? <p className="rounded-xl border border-hair bg-glass px-3 py-2 text-[13px] text-red-700 dark:text-red-300">{loadError}</p> : null}
        {!data && !loadError ? <p className="py-4 text-center text-[13px] text-muted">Loading who has access…</p> : null}

        {data && !adding ? (
          <>
            <section>
              <h3 className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[.07em] text-muted">People with access</h3>
              <ul className="overflow-hidden rounded-2xl border border-hair bg-glass">
                {data.people.map((p) => (
                  <li key={p.id} className="flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(150deg,#38bdf8,#0284c7)] text-[13px] font-bold text-white">{initial(p.name ?? p.email)}</span>
                    <span className="min-w-0 flex-1">
                      <b className="block truncate text-[14px] font-semibold">{p.name ?? p.email}</b>
                      {p.name && p.email ? <small className="block truncate text-[12px] text-muted">{p.email}</small> : null}
                    </span>
                    {p.isOwner || (p.role !== "reader" && p.role !== "commenter" && p.role !== "writer") ? (
                      <span className="shrink-0 px-1 text-[13px] text-muted">Owner</span>
                    ) : (
                      <RoleSelect
                        label={`Access for ${p.email ?? p.name ?? "person"}`}
                        value={p.role}
                        disabled={pending}
                        onChange={(v) =>
                          v === "remove"
                            ? apply(() => removeShareAccess(folderId, { permissionId: p.id }), `Removed ${p.email ?? "access"}`)
                            : apply(() => changeShareRole(folderId, { permissionId: p.id, role: v }), "Access updated")
                        }
                        extra={
                          <>
                            <option disabled>──────────</option>
                            <option value="remove">Remove access</option>
                          </>
                        }
                      />
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h3 className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[.07em] text-muted">General access</h3>
              <div className="flex items-center gap-2.5 rounded-2xl border border-hair bg-glass px-3 py-2.5">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${data.general.access === "anyone" ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300" : "bg-chip text-muted"}`}>
                  {data.general.access === "anyone" ? <Globe size={16} /> : <Lock size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <select
                    aria-label="General access"
                    className="-ml-1 max-w-full bg-transparent text-[14px] font-semibold text-ink"
                    value={data.general.access}
                    disabled={pending}
                    onChange={(e) => apply(() => setGeneralAccess(folderId, { access: e.target.value, role: data.general.role }), "General access updated")}
                  >
                    <option value="restricted">Restricted</option>
                    <option value="anyone">Anyone with the link</option>
                  </select>
                  <small className="block text-[12px] leading-snug text-muted">
                    {data.general.access === "anyone" ? "Anyone on the internet with the link can open it" : "Only people with access can open with the link"}
                  </small>
                </div>
                {data.general.access === "anyone" ? (
                  <RoleSelect label="Role for anyone with the link" value={data.general.role} disabled={pending} onChange={(v) => apply(() => setGeneralAccess(folderId, { access: "anyone", role: v }), "Link access updated")} />
                ) : null}
              </div>
            </section>

            <input ref={linkRef} readOnly value={data.url} aria-label="Folder link" className={`${inputCls} min-h-9 py-1 text-[12px] text-muted`} onFocus={(e) => e.currentTarget.select()} />
            <div className="flex gap-2">
              <button type="button" onClick={copyLink} className={`${btnSecondary} min-h-11 flex-1 text-[14px]`}>
                {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Link copied" : "Copy link"}
              </button>
              <button type="button" onClick={onClose} className={`${btnPrimary} min-h-11 flex-1 text-[14px]`}>Done</button>
            </div>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}

/** Compact "Share" button that opens the sheet (month cards, Finance root card). */
export function ShareFolderButton({ folderId, title, className = "" }: { folderId: string; title: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Share ${title}`} className={`inline-flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-hair bg-chip px-2.5 text-[12px] font-semibold text-ink active:opacity-70 ${className}`}>
        <Share2 size={14} /> Share
      </button>
      {open ? <DriveShareSheet folderId={folderId} title={title} open onClose={() => setOpen(false)} /> : null}
    </>
  );
}
