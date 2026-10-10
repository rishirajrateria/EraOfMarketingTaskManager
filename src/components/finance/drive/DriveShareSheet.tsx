"use client";
import { useEffect, useState, useTransition } from "react";
import { Share2 } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { changeShareRole, getFolderSharing, removeShareAccess, setGeneralAccess, shareFolder } from "@/server/finance/drive-share";
import type { FolderSharing } from "@/server/finance/drive-share-core";
import type { ActionResult } from "@/lib/action-result";
import { EmailChips, isEmail } from "@/components/finance/drive/EmailChips";
import { GeneralAccess, LinkActions, RoleSelect, SendBar, ShareAvatar, shareHeading, type Role } from "@/components/finance/drive/ShareParts";

/**
 * Share sheet for a Finance / month folder (ADR 0013), laid out like Google Drive's share dialog: Add people (chips +
 * role + Notify people + message), People with access (owner fixed; others change role or lose access), General
 * access (Restricted / Anyone with the link + role) and Copy link.
 */
export function DriveShareSheet({ folderId, title, open, onClose }: { folderId: string; title: string; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<FolderSharing | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [emails, setEmails] = useState<string[]>([]);
  const [role, setRole] = useState<Role>("reader");
  const [notify, setNotify] = useState(true);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();

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
            <SendBar notify={notify} setNotify={setNotify} message={message} setMessage={setMessage} onCancel={() => setEmails([])} onSend={send} pending={pending} canSend={invalid.length === 0} />
          ) : null}
        </section>

        {loadError ? <p className="rounded-xl border border-hair bg-glass px-3 py-2 text-[13px] text-red-700 dark:text-red-300">{loadError}</p> : null}
        {!data && !loadError ? <p className="py-4 text-center text-[13px] text-muted">Loading who has access…</p> : null}

        {data && !adding ? (
          <>
            <section>
              <h3 className={shareHeading}>People with access</h3>
              <ul className="overflow-hidden rounded-2xl border border-hair bg-glass">
                {data.people.map((p) => (
                  <li key={p.id} className="flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0">
                    <ShareAvatar text={p.name ?? p.email} />
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
                        removable
                      />
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <GeneralAccess general={data.general} disabled={pending} onChange={(access, linkRole) => apply(() => setGeneralAccess(folderId, { access, role: linkRole }), access === data.general.access ? "Link access updated" : "General access updated")} />
            <LinkActions url={data.url} label="Folder link" onClose={onClose} />
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
      <button type="button" onClick={() => setOpen(true)} aria-label={`Share ${title}`} className={`inline-flex h-8 shrink-0 items-center gap-[3px] whitespace-nowrap rounded-full border border-hair bg-chip px-[7px] text-[11px] font-semibold text-ink active:opacity-70 ${className}`}>
        <Share2 size={13} /> Share
      </button>
      {open ? <DriveShareSheet folderId={folderId} title={title} open onClose={() => setOpen(false)} /> : null}
    </>
  );
}
