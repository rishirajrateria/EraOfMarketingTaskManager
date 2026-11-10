"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { UserPlus, X } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { useToast } from "@/components/ui/Toast";
import { EmailChips, isEmail } from "@/components/finance/drive/EmailChips";
import { GeneralAccess, LinkActions, RoleSelect, SendBar, ShareAvatar, roleLabel, shareHeading, type Role } from "@/components/finance/drive/ShareParts";
import { changeKitShareRole, getKitSharing, removeKitShareAccess, setKitGeneralAccess, shareKit } from "@/server/clients/kit-share";
import type { KitSharePerson, KitSharing } from "@/server/clients/kit-share-core";
import { ROLE_TAG, firstName, teamSuggestions, type KitScopeKey, type KitScopeOption, type TeamMember } from "@/server/clients/kit-share-scopes";
import type { ActionResult } from "@/lib/action-result";

/**
 * Client kit Share sheet (ADR 0014), like Google Drive's: pick the whole kit or one part, add people — one-tap team
 * chips for Team leaders and Executives, or any email — each with their own access, then see who has access here
 * (and who has it through the whole kit), general access and the link. Switching parts keeps the people being added.
 */
type Adding = { email: string; role: Role };
const rowCls = "flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0";
const listCls = "overflow-hidden rounded-2xl border border-hair bg-glass";

function Who({ email, name, dir }: { email: string | null; name: string | null; dir: Map<string, TeamMember> }) {
  const u = email ? dir.get(email) : undefined;
  const title = u?.name ?? name ?? email?.split("@")[0] ?? "Someone";
  const tag = u ? ROLE_TAG[u.role] : null;
  const sub = [tag, email].filter(Boolean).join(" · ");
  return (
    <span className="min-w-0 flex-1">
      <b className="block truncate text-[14px] font-semibold">{title}</b>
      {sub ? <small className="block truncate text-[12px] text-muted">{sub}</small> : null}
    </span>
  );
}

export function KitShareSheet({ clientId, scopes, onClose }: { clientId: string; scopes: KitScopeOption[]; onClose: () => void }) {
  const toast = useToast();
  const [scope, setScope] = useState<KitScopeKey>(scopes[0]?.key ?? "kit");
  const [data, setData] = useState<KitSharing | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState<Adding[]>([]);
  const [notify, setNotify] = useState(true);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    setData(null);
    setLoadError(null);
    void getKitSharing(clientId, { scope }).then((r) => {
      if (!live) return;
      if (!r.ok) return setLoadError(r.error);
      setData(r.data);
      setTeam(r.data.team);
    });
    return () => {
      live = false;
    };
  }, [clientId, scope]);

  const dir = useMemo(() => new Map(team.map((u) => [u.email, u])), [team]);
  const current = scopes.find((s) => s.key === scope) ?? scopes[0];
  const loaded = data?.scope === scope ? data : null;
  const directEmails = loaded ? loaded.people.filter((p) => !p.inherited).map((p) => p.email) : [];
  const suggestions = loaded ? teamSuggestions(team, [...directEmails, ...adding.map((a) => a.email)]) : [];

  const addEmails = (emails: string[]) => {
    const bad = emails.filter((e) => !isEmail(e));
    if (bad.length) toast(`“${bad.join(", ")}” isn't an email`, "err");
    const owner = loaded?.owner;
    if (owner && emails.includes(owner)) toast(`${owner} owns this kit already`, "err");
    const fresh = emails.filter((e) => isEmail(e) && e !== owner && !adding.some((a) => a.email === e));
    if (fresh.length) setAdding((list) => [...list, ...fresh.map((email) => ({ email, role: "reader" as Role }))]);
  };

  const apply = (call: () => Promise<ActionResult<KitSharing>>, done: string) =>
    start(async () => {
      const r = await call();
      if (!r.ok) return toast(r.error, "err");
      setData(r.data);
      toast(done);
    });

  const send = () =>
    start(async () => {
      const r = await shareKit(clientId, { scope, people: adding, notify, message: notify && message.trim() ? message.trim() : null });
      if (!r.ok) return toast(r.error, "err");
      setData(r.data.sharing);
      setAdding([]);
      setMessage("");
      const n = r.data.added.length;
      const failed = r.data.failed.length ? ` · could not add ${r.data.failed.map((f) => f.email).join(", ")}` : "";
      toast(`Shared “${r.data.sharing.name}” with ${n} ${n === 1 ? "person" : "people"}${notify ? " · email sent" : ""}${failed}`);
    });

  const personRow = (p: KitSharePerson) => (
    <li key={`${p.inherited ? "kit" : "here"}-${p.id}`} className={rowCls}>
      <ShareAvatar text={(p.email && dir.get(p.email)?.name) ?? p.name ?? p.email} />
      <Who email={p.email} name={p.name} dir={dir} />
      {p.isOwner || p.inherited || (p.role !== "reader" && p.role !== "commenter" && p.role !== "writer") ? (
        <span className="shrink-0 whitespace-nowrap px-1 text-right text-[12.5px] text-muted">{p.isOwner ? "Owner" : `${roleLabel(p.role)} · whole kit`}</span>
      ) : (
        <RoleSelect
          label={`Access for ${p.email ?? p.name ?? "person"}`}
          value={p.role}
          disabled={pending}
          removable
          onChange={(v) =>
            v === "remove"
              ? apply(() => removeKitShareAccess(clientId, { scope, permissionId: p.id }), `Removed ${p.email ?? "access"}`)
              : apply(() => changeKitShareRole(clientId, { scope, permissionId: p.id, role: v }), `${p.email ?? "Access"} is now ${roleLabel(v).toLowerCase()}`)
          }
        />
      )}
    </li>
  );

  return (
    <Sheet open onClose={onClose} title={`Share “${loaded?.title ?? current?.label ?? "Client kit"}”`}>
      <div className="space-y-4 px-4 pb-5">
        <section>
          <h3 className={shareHeading}>What to share</h3>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="What to share">
            {scopes.map((s) => (
              <button
                key={s.key}
                type="button"
                aria-pressed={s.key === scope}
                onClick={() => setScope(s.key)}
                className={`h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-[12.5px] font-semibold active:opacity-70 ${s.key === scope ? "border-transparent bg-primary text-primary-ink" : "border-hair bg-chip text-ink"}`}
              >
                {s.name}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-2.5">
          <EmailChips value={[]} onChange={addEmails} disabled={pending} />
          {suggestions.length ? (
            <div className="min-w-0">
              <h3 className={shareHeading}>Your team</h3>
              <div key={scope} className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Add from your team">
                {suggestions.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => setAdding((list) => [...list, { email: u.email, role: "reader" }])}
                    aria-label={`Add ${u.name} (${ROLE_TAG[u.role]})`}
                    className="flex h-[34px] shrink-0 items-center gap-1.5 rounded-full border border-hair bg-chip pl-1 pr-2.5 text-[13px] font-semibold text-ink active:opacity-70"
                  >
                    <ShareAvatar text={u.name} size="sm" />
                    <span>{firstName(u.name)}</span>
                    <small className="text-[10px] font-bold uppercase tracking-[.04em] text-muted">{u.role === "TEAM_LEADER" ? "TL" : "Exec"}</small>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        {adding.length ? (
          <section className="space-y-3">
            <div>
              <h3 className={shareHeading}>Adding · pick access for each</h3>
              <ul className={listCls}>
                {adding.map((a) => (
                  <li key={a.email} className={rowCls}>
                    <ShareAvatar text={dir.get(a.email)?.name ?? a.email} />
                    <Who email={a.email} name={null} dir={dir} />
                    <RoleSelect label={`Access for ${a.email}`} value={a.role} disabled={pending} onChange={(v) => setAdding((list) => list.map((x) => (x.email === a.email ? { ...x, role: v as Role } : x)))} />
                    <button type="button" aria-label={`Remove ${a.email}`} onClick={() => setAdding((list) => list.filter((x) => x.email !== a.email))} className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted active:bg-chip">
                      <X size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <SendBar notify={notify} setNotify={setNotify} message={message} setMessage={setMessage} onCancel={() => setAdding([])} onSend={send} pending={pending} canSend={!loadError} />
          </section>
        ) : null}

        {loadError ? <p className="rounded-xl border border-hair bg-glass px-3 py-2 text-[13px] text-red-700 dark:text-red-300">{loadError}</p> : null}
        {!loaded && !loadError ? <p className="py-4 text-center text-[13px] text-muted">Loading who has access…</p> : null}

        {loaded && !adding.length ? (
          <>
            <section>
              <h3 className={shareHeading}>People with access</h3>
              <ul className={listCls}>{loaded.people.map(personRow)}</ul>
            </section>
            <GeneralAccess
              general={loaded.general}
              inheritedLink={loaded.inheritedLink}
              disabled={pending}
              onChange={(access, linkRole) => apply(() => setKitGeneralAccess(clientId, { scope, access, role: linkRole }), access === "anyone" ? "Anyone with the link can open it" : "Only people with access can open it")}
            />
            <LinkActions url={loaded.url} label={`${loaded.name} link`} onClose={onClose} />
          </>
        ) : null}
      </div>
    </Sheet>
  );
}

/** "Share" button on the kit pages; opens the sheet on the whole kit. */
export function KitShareButton({ clientId, scopes, displayName }: { clientId: string; scopes: KitScopeOption[]; displayName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Share ${displayName} kit`} className="inline-flex h-8 shrink-0 items-center gap-[3px] whitespace-nowrap rounded-full border border-hair bg-chip px-[7px] text-[11px] font-semibold text-ink active:opacity-70">
        <UserPlus size={13} /> Share
      </button>
      {open ? <KitShareSheet clientId={clientId} scopes={scopes} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
