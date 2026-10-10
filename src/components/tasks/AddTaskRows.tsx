"use client";
import { useRef } from "react";
import { clsx } from "@/lib/clsx";
import type { DashboardData } from "@/server/tasks/types";
import {
  executivesOf,
  isSpecialist,
  specialistsFirst,
  teamLeadersOf,
  toggleAdminTeam,
  toggleId,
  workTeamIds,
  workTypesFor,
  externalGuests,
  meetingInvitees,
  type AddTaskForm,
} from "@/components/tasks/add-task-helpers";
import { START_SLOTS, fmtStartPill, meetingTz, parseHHMM, pickClient, pickStartTime, startMinutes } from "@/components/tasks/meeting-helpers";

const first = (name: string) => name.split(" ")[0] ?? name;

/** Frosted green pill (28px; near-white when active). `pref` adds the dark ring of a preferred executive. */
export function TagPill({ active, pref, onClick, children }: { active: boolean; pref?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "no-select h-7 shrink-0 whitespace-nowrap rounded-full px-[13px] text-xs font-medium leading-none transition",
        active ? "bg-green-pill-on" : "bg-green-pill",
        active && pref && "bg-green-pill-pref",
      )}
    >
      {children}
    </button>
  );
}

/** One labelled green row: small uppercase white label on the left, scrollable pills on the right. */
export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="scrollbar-none flex h-10 items-center gap-2 overflow-x-auto px-3" role="group" aria-label={label}>
      <span className="min-w-[52px] shrink-0 text-[10px] font-bold uppercase tracking-[.08em] text-z2label">{label}</span>
      {children}
    </div>
  );
}

const Note = ({ children }: { children: React.ReactNode }) => <span className="shrink-0 whitespace-nowrap text-[11px] font-medium text-z2label">{children}</span>;

type Props = { form: AddTaskForm; patch: (p: Partial<AddTaskForm>) => void; data: DashboardData };

/**
 * GREEN AREA (TAG MODE, ADR 0008), top to bottom: PREFER (Admin) · WORK · TEAM (Admin) / EXEC (Team Leader) · CLIENT.
 * TEAM stays fixed directly above CLIENT; WORK and PREFER appear above it once a team is picked.
 */
export function AddTaskGreenRows({ form, patch, data }: Props) {
  const role = data.role;
  const meeting = form.type === "MEETING";
  const workId = form.tagIds[0] ?? "";
  const teamPicked = role !== "ADMIN" || form.teamIds.length > 0;
  const works = workTypesFor(data.workTypes, workTeamIds(form, data));

  const preferRow =
    role === "ADMIN" && teamPicked && !meeting ? (
      <Row label="Prefer">
        <TagPill active={!form.preferredAssigneeIds.length} onClick={() => patch({ preferredAssigneeIds: [] })}>
          No preference
        </TagPill>
        {specialistsFirst(executivesOf(data, form.teamIds), workId).map((e) => {
          const on = form.preferredAssigneeIds.includes(e.id);
          return (
            <TagPill key={e.id} pref active={on} onClick={() => patch({ preferredAssigneeIds: toggleId(form.preferredAssigneeIds, e.id) })}>
              {(on ? "★ " : "") + first(e.name) + (isSpecialist(e, workId) ? " ✓" : "")}
            </TagPill>
          );
        })}
        {executivesOf(data, form.teamIds).length ? null : <Note>no executives in this team yet</Note>}
      </Row>
    ) : null;

  const workRow =
    teamPicked && !meeting ? (
      <Row label="Work">
        {works.length ? (
          works.map((w) => (
            <TagPill key={w.id} active={workId === w.id} onClick={() => patch({ tagIds: [w.id] })}>
              {w.name}
            </TagPill>
          ))
        ) : (
          <Note>no work types for this team · Menu → Add Work</Note>
        )}
      </Row>
    ) : null;

  let teamRow: React.ReactNode = null;
  if (meeting) {
    // Meetings (ADR 0012): TEAM = "invite these teams" (Team Leader + executives), multi-select, every role.
    teamRow = (
      <Row label="Team">
        {data.teams.map((t) => (
          <TagPill key={t.id} active={form.teamIds.includes(t.id)} onClick={() => patch({ teamIds: toggleId(form.teamIds, t.id) })}>
            {t.name}
          </TagPill>
        ))}
      </Row>
    );
  } else if (role === "ADMIN") {
    teamRow = (
      <Row label="Team">
        {data.teams.map((t) => (
          <TagPill key={t.id} active={form.teamIds.includes(t.id)} onClick={() => patch(toggleAdminTeam(form, data, t.id))}>
            {t.name}
          </TagPill>
        ))}
      </Row>
    );
  } else if (role === "TEAM_LEADER") {
    const execs = specialistsFirst(data.me.teamId ? executivesOf(data, [data.me.teamId]) : [], workId);
    teamRow = (
      <Row label="Exec">
        <TagPill active={form.assigneeIds.includes(data.me.id)} onClick={() => patch({ assigneeIds: toggleId(form.assigneeIds, data.me.id) })}>
          me
        </TagPill>
        {execs.map((e) => (
          <TagPill key={e.id} active={form.assigneeIds.includes(e.id)} onClick={() => patch({ assigneeIds: toggleId(form.assigneeIds, e.id) })}>
            {first(e.name) + (isSpecialist(e, workId) ? " ✓" : "")}
          </TagPill>
        ))}
      </Row>
    );
  }

  return (
    <div className="bg-green-area shrink-0">
      {preferRow}
      {workRow}
      {teamRow}
      <Row label="Client">
        {data.clients.map((c) => (
          <TagPill key={c.id} active={form.clientId === c.id} onClick={() => patch(pickClient(form, data, c.id))}>
            {c.name}
          </TagPill>
        ))}
      </Row>
      {meeting && !form.meeting?.allDay ? <StartRow form={form} patch={patch} tz={meetingTz(form, data.tz)} /> : null}
    </div>
  );
}

/**
 * Meetings: START row directly above the bottom bar — a pill every 30 minutes 9 am … 8 pm plus "Custom…" (native time
 * input). The day comes from Tom / today / the calendar icon, else today when the time is still ahead, else tomorrow.
 */
function StartRow({ form, patch, tz }: { form: AddTaskForm; patch: (p: Partial<AddTaskForm>) => void; tz: string }) {
  const custom = useRef<HTMLInputElement>(null);
  const chosen = startMinutes(form.scheduledStart);
  const isCustom = chosen !== null && !START_SLOTS.includes(chosen);
  const set = (min: number) => patch({ scheduledStart: pickStartTime(form.scheduledStart, min, new Date(), tz) });
  const openCustom = () => {
    const el = custom.current;
    if (!el) return;
    try {
      el.showPicker();
    } catch {
      el.focus();
      el.click();
    }
  };
  return (
    <Row label="Start">
      {START_SLOTS.map((min) => (
        <TagPill key={min} active={chosen === min} onClick={() => set(min)}>
          {fmtStartPill(min)}
        </TagPill>
      ))}
      <span className="relative shrink-0">
        <TagPill active={isCustom} onClick={openCustom}>
          {isCustom && chosen !== null ? fmtStartPill(chosen) : "Custom…"}
        </TagPill>
        <input
          ref={custom}
          type="time"
          step={300}
          aria-label="Custom start time"
          tabIndex={-1}
          value={chosen !== null ? form.scheduledStart.slice(11, 16) : ""}
          onChange={(e) => {
            const min = parseHHMM(e.target.value);
            if (min !== null) set(min);
          }}
          className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
        />
      </span>
    </Row>
  );
}

/** Meetings: who is invited (internal names, teams, outside guests) and the client-without-email hint. */
function MeetingSummary({ form, data }: Omit<Props, "patch">) {
  // Only known names / addresses are joined — never "null" / "undefined" when there is no client or team.
  const name = (id: string) => (id === data.me.id ? "me" : first(data.people.find((p) => p.id === id)?.name || "someone"));
  const invitees = meetingInvitees(form, data);
  const external = externalGuests(form).filter(Boolean);
  const teams = data.teams.filter((t) => form.teamIds.includes(t.id) && !!t.name);
  const led = teams.filter((t) => teamLeadersOf(data, [t.id]).length);
  const leaderless = teams.filter((t) => !led.includes(t)).map((t) => t.name);
  const client = form.clientId ? data.clients.find((c) => c.id === form.clientId) : undefined;
  const noEmail = !!client?.name && !(client.emails ?? []).length;
  return (
    <div className="glass-card mt-3 px-3 py-2.5 text-[12.5px] leading-snug text-ink" aria-live="polite">
      <div>
        Inviting <b>{invitees.map(name).join(", ")}</b>
        {led.length ? <span className="text-muted">{` · ${led.map((t) => t.name).join(", ")} (Team Leader${led.length === 1 ? "" : "s"})`}</span> : null}
      </div>
      {leaderless.length ? <div className="mt-1 text-amber-700 dark:text-amber-300">{`${leaderless.join(", ")}: no Team Leader yet — invite people in 👥 Guests`}</div> : null}
      <div className={clsx("mt-1", !external.length && "text-muted")}>{external.length ? `Guests: ${external.join(", ")}` : "No outside guests · add emails in 👥 Guests"}</div>
      {noEmail ? <div className="mt-1 text-amber-700 dark:text-amber-300">{`${client?.name ?? ""} has no email — add one in Clients`}</div> : null}
      <div className="mt-1 text-muted">Google Calendar emails the invites{form.meeting?.withMeet === false ? "" : " with the Meet link"}.</div>
    </div>
  );
}

/** Body card: who gets the task (Admin: "Goes to Priya (TL, Social)", preference, specialists; TL: "Assigned to …"). */
export function AddTaskSummary({ form, data }: Omit<Props, "patch">) {
  if (form.type === "MEETING") return <MeetingSummary form={form} data={data} />;
  const name = (id: string) => (id === data.me.id ? "me" : first(data.people.find((p) => p.id === id)?.name ?? "?"));
  const muted = "text-muted";
  let body: React.ReactNode = null;
  if (data.role === "ADMIN") {
    if (!form.teamIds.length) {
      body = (
        <>
          <b>Pick a team below.</b>
          <div className={muted}>The task goes to that team&apos;s Team Leader. Then tap executives to say who you&apos;d prefer; the Team Leader makes the final call.</div>
        </>
      );
    } else {
      const tls = teamLeadersOf(data, form.teamIds);
      const teamName = (id: string | null) => data.teams.find((t) => t.id === id)?.name ?? "";
      const work = form.type === "WORK" ? data.workTypes.find((w) => w.id === form.tagIds[0]) : undefined;
      const specialists = work ? executivesOf(data, form.teamIds).filter((p) => isSpecialist(p, work.id)) : [];
      body = (
        <>
          <div>
            Goes to <b>{tls.map((u) => `${first(u.name)} (TL, ${teamName(u.teamId)})`).join(", ") || "— no Team Leader in this team yet"}</b>
          </div>
          {form.type === "WORK" ? (
            <div className="mt-1">
              {form.preferredAssigneeIds.length ? (
                <>
                  Your preference: <b>{form.preferredAssigneeIds.map(name).join(", ")}</b>
                  <span className={muted}> · the Team Leader decides</span>
                </>
              ) : (
                <span className={muted}>No executive preference · tap names in the PREFER row</span>
              )}
            </div>
          ) : null}
          {work ? <div className={clsx("mt-1", muted)}>{`✓ ${work.name} specialists: ${specialists.map((p) => first(p.name)).join(", ") || "none yet"}`}</div> : null}
        </>
      );
    }
  } else if (data.role === "TEAM_LEADER") {
    body = form.assigneeIds.length ? (
      <div>
        Assigned to <b>{form.assigneeIds.map(name).join(", ")}</b>
      </div>
    ) : (
      <div>
        <b>Your whole team</b>
        <span className={muted}> · tap names in the EXEC row to pick</span>
      </div>
    );
  }
  if (!body) return null;
  return (
    <div className="glass-card mt-3 px-3 py-2.5 text-[12.5px] leading-snug text-ink" aria-live="polite">
      {body}
    </div>
  );
}
