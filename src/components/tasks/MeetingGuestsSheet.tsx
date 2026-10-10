"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { clsx } from "@/lib/clsx";
import { Sheet } from "@/components/ui/Sheet";
import { btnPrimary, btnSecondary, inputCls } from "@/components/ui/Field";
import { GroupLabel, SegButton } from "@/components/ui/Controls";
import type { DashboardData } from "@/server/tasks/types";
import { isEmail, normaliseEmails, splitEmails } from "@/server/tasks/meeting";
import { teamLeadersOf, toggleId, type AddTaskForm, type Person } from "@/components/tasks/add-task-helpers";
import { guestCount } from "@/components/tasks/meeting-helpers";

const first = (name: string) => name.split(" ")[0] ?? name;

/** Removable chip (26px). */
export function GuestChip({ label, onRemove, tone }: { label: string; onRemove?: () => void; tone?: "team" }) {
  return (
    <li className={clsx("flex h-[26px] max-w-full items-center gap-1 rounded-full border border-hair pl-2.5 text-[11.5px] text-ink", tone === "team" ? "bg-[#d1fae5] dark:bg-[#064e3b]" : "bg-chip", onRemove ? "pr-1" : "pr-2.5")}>
      <span className="truncate">{label}</span>
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className="flex h-5 w-5 shrink-0 items-center justify-center text-muted">
          <X size={11} aria-hidden />
        </button>
      ) : null}
    </li>
  );
}

/**
 * Email chips + input: Enter, comma or blur adds; a paste of several comma / space separated addresses adds them
 * all. Invalid addresses stay in the input and are reported through `onError`.
 */
export function GuestEmailInput({ emails, onChange, onError, exclude = [] }: { emails: string[]; onChange: (v: string[]) => void; onError: (m: string) => void; exclude?: string[] }) {
  const [text, setText] = useState("");
  const commit = (raw: string) => {
    const parts = splitEmails(raw);
    if (!parts.length) return setText("");
    const bad = parts.filter((p) => !isEmail(p));
    const good = normaliseEmails(parts.filter(isEmail)).filter((e) => !exclude.includes(e));
    if (good.length) onChange(normaliseEmails([...emails, ...good]));
    setText(bad.join(", "));
    if (bad.length) onError(`Not an email: ${bad.join(", ")}`);
  };
  return (
    <div>
      {emails.length ? (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Guest emails">
          {emails.map((e) => (
            <GuestChip key={e} label={e} onRemove={() => onChange(emails.filter((x) => x !== e))} />
          ))}
        </ul>
      ) : null}
      <input
        type="text"
        inputMode="email"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        className={inputCls}
        placeholder="Add guests · email, then Enter"
        aria-label="Add guests"
        value={text}
        onChange={(e) => {
          const v = e.target.value;
          if (/[,;]\s*$/.test(v)) commit(v);
          else setText(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit(text);
          }
        }}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData("text");
          if (/[\s,;]/.test(pasted.trim())) {
            e.preventDefault();
            commit(`${text} ${pasted}`);
          }
        }}
        onBlur={() => text.trim() && commit(text)}
      />
    </div>
  );
}

/**
 * Meeting guests (ADR 0012), from the people glyph / 👥 Guests chip: the client's addresses and the invited teams as
 * removable chips, internal people (they become assignees and see the meeting on their dashboard) and outside
 * guests by email. Google Calendar emails everyone the invite.
 */
export function MeetingGuestsSheet({
  open,
  onClose,
  form,
  patch,
  data,
  people,
  onFindTime,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  form: AddTaskForm;
  patch: (p: Partial<AddTaskForm>) => void;
  data: DashboardData;
  people: Person[];
  onFindTime: () => void;
  onError: (m: string) => void;
}) {
  const client = data.clients.find((c) => c.id === form.clientId);
  const teams = data.teams.filter((t) => form.teamIds.includes(t.id));
  // A team invites only its Team Leader(s) (owner's revision); executives are optional, one by one.
  const viaTeam = new Set(teamLeadersOf(data, form.teamIds).map((p) => p.id));
  const n = guestCount(form, data);
  return (
    <Sheet open={open} onClose={onClose} title={`Guests · ${n}`}>
      <div className="space-y-4 px-4 pb-5 pt-1">
        <section>
          <GroupLabel>From client</GroupLabel>
          {form.clientGuests.length ? (
            <ul className="flex flex-wrap gap-1.5">
              {form.clientGuests.map((e) => (
                <GuestChip key={e} label={e} onRemove={() => patch({ clientGuests: form.clientGuests.filter((x) => x !== e) })} />
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">
              {client ? ((client.emails ?? []).length ? `${client.name}'s email was removed — pick the client again to add it back` : `${client.name} has no email — add one in Clients`) : "Pick a client in the rows below to invite them"}
            </p>
          )}
        </section>

        {teams.length ? (
          teams.map((t) => {
            const leaders = teamLeadersOf(data, [t.id]);
            const unTeam = () => patch({ teamIds: form.teamIds.filter((x) => x !== t.id) });
            return (
              <section key={t.id}>
                <GroupLabel>{`From teams · ${t.name}`}</GroupLabel>
                <ul className="flex flex-wrap gap-1.5">
                  {leaders.length ? (
                    leaders.map((l) => <GuestChip key={l.id} tone="team" label={`${l.name} · Team leader`} onRemove={unTeam} />)
                  ) : (
                    <GuestChip tone="team" label={`${t.name} has no Team Leader yet`} onRemove={unTeam} />
                  )}
                </ul>
              </section>
            );
          })
        ) : (
          <section>
            <GroupLabel>From teams</GroupLabel>
            <p className="text-xs text-muted">Tap a team in the TEAM row to invite its Team Leader.</p>
          </section>
        )}

        <section>
          <GroupLabel>Your people</GroupLabel>
          <div className="flex flex-wrap gap-2">
            {people
              .filter((a) => !viaTeam.has(a.id))
              .map((a) => {
                const me = a.id === data.me.id;
                return (
                  <SegButton key={a.id} on={me || form.assigneeIds.includes(a.id)} onClick={() => (me ? undefined : patch({ assigneeIds: toggleId(form.assigneeIds, a.id) }))} className={me ? "opacity-80" : undefined}>
                    {me ? `${first(a.name)} (organiser)` : a.name}
                  </SegButton>
                );
              })}
          </div>
        </section>

        <section>
          <GroupLabel>Add guests</GroupLabel>
          <GuestEmailInput emails={form.guestEmails} onChange={(guestEmails) => patch({ guestEmails })} onError={onError} exclude={form.clientGuests} />
          <p className="mt-2 text-[11.5px] text-muted">Google Calendar emails everyone the invite{form.meeting.withMeet ? " with the Meet link" : ""}. Outside guests need no account here.</p>
        </section>

        <div className="flex gap-2.5">
          <button type="button" className={clsx(btnSecondary, "flex-1")} onClick={onFindTime}>
            Find a time
          </button>
          <button type="button" onClick={onClose} className={clsx(btnPrimary, "flex-1")}>
            Done
          </button>
        </div>
      </div>
    </Sheet>
  );
}
