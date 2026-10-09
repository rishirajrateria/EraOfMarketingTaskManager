"use client";
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
  type AddTaskForm,
} from "@/components/tasks/add-task-helpers";

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
function Row({ label, children }: { label: string; children: React.ReactNode }) {
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
  if (role === "ADMIN") {
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
          <TagPill key={c.id} active={form.clientId === c.id} onClick={() => patch({ clientId: form.clientId === c.id ? "" : c.id })}>
            {c.name}
          </TagPill>
        ))}
      </Row>
    </div>
  );
}

/** Body card: who gets the task (Admin: "Goes to Priya (TL, Social)", preference, specialists; TL: "Assigned to …"). */
export function AddTaskSummary({ form, data }: Omit<Props, "patch">) {
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
