"use client";
import { useRef } from "react";
import { clsx } from "@/lib/clsx";
import type { DashboardData } from "@/server/tasks/types";
import {
  executivesOf,
  isSpecialist,
  specialistsFirst,
  toggleAdminTeam,
  toggleId,
  workTeamIds,
  workTypesFor,
  type AddTaskForm,
} from "@/components/tasks/add-task-helpers";
import { START_SLOTS, fmtStartPill, meetingTz, parseHHMM, pickClient, pickStartTime, startMinutes } from "@/components/tasks/meeting-helpers";

const first = (name: string) => name.split(" ")[0] ?? name;

/**
 * Neutral glass pill (ADR 0015 — same look as the dashboard filter rows): 32px, ink-filled when on. `pref` adds an inner
 * ring to a preferred executive.
 */
export function TagPill({ active, pref, onClick, children }: { active: boolean; pref?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "no-select h-8 shrink-0 whitespace-nowrap rounded-[12px] border px-[11px] text-[12.5px] font-semibold leading-none transition",
        active ? "border-transparent bg-primary text-primary-ink" : "glass-chip border-hair text-ink",
        active && pref && "shadow-[inset_0_0_0_2px_var(--bg)]",
      )}
    >
      {children}
    </button>
  );
}

/**
 * One labelled row: small uppercase muted label on the left, pills on the right. Only the pills scroll horizontally —
 * the label stays put (ADR 0015; it used to scroll away on the long START / CLIENT rows).
 */
export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex h-[42px] items-center" role="group" aria-label={label}>
      <span className="w-[64px] shrink-0 pl-3 text-[10.5px] font-extrabold uppercase tracking-[.07em] text-muted">{label}</span>
      <div className="scrollbar-none flex h-full min-w-0 flex-1 items-center gap-2 overflow-x-auto pl-2 pr-3 [mask-image:linear-gradient(to_right,transparent,#000_8px)]">{children}</div>
    </div>
  );
}

const Note = ({ children }: { children: React.ReactNode }) => <span className="shrink-0 whitespace-nowrap text-[11px] font-medium text-muted">{children}</span>;

type Props = { form: AddTaskForm; patch: (p: Partial<AddTaskForm>) => void; data: DashboardData };

/**
 * TAG ROWS (ADR 0008; neutral glass since ADR 0015), top to bottom: PREFER (Admin) · WORK · TEAM (Admin) / EXEC (Team Leader) · CLIENT.
 * TEAM stays fixed directly above CLIENT; WORK and PREFER appear above it once a team is picked. They sit in the
 * add-task screen's details tray (AddTaskTray), which draws the glass behind them.
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
    <div className="pb-0.5">
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
