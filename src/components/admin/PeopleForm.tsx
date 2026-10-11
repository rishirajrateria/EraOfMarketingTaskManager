"use client";
import { useState } from "react";
import type { Role } from "@prisma/client";
import { Field, inputCls } from "@/components/ui/Field";
import { FormFooter, PillPicker, WeekdayPicker, hoursToMinutes, minutesToHours } from "@/components/admin/AdminUi";
import type { LeaderOption, PersonRow, TeamOption, WorkTypeOption } from "@/server/admin/queries";
import type { UserInput } from "@/server/admin/schemas";
import { domainHint } from "@/lib/domains";

/** Assignable roles. CA access is parked (ADR 0004) — not offered here and rejected by the server. */
export const ROLE_OPTIONS: { value: Role; label: string; hint?: string }[] = [
  { value: "EXECUTIVE", label: "Executive" },
  { value: "TEAM_LEADER", label: "Team Leader" },
  { value: "HR", label: "HR" },
  { value: "ADMIN", label: "Admin" },
];

export type PeopleFormValues = UserInput;

function initial(user: PersonRow | null, role: Role): PeopleFormValues {
  return {
    email: user?.email ?? "",
    name: user?.name ?? "",
    role: user?.role ?? role,
    phone: user?.phone ?? "",
    teamId: user?.teamId ?? null,
    teamLeaderId: user?.teamLeaderId ?? null,
    dailyCapacityMinutes: user?.dailyCapacityMinutes ?? null,
    workingDays: user?.workingDays ?? [1, 2, 3, 4, 5, 6],
    specialityIds: user?.specialities.map((w) => w.id) ?? [],
  };
}

/** Work types a member of `teamId` can specialise in (legacy no-team work types count for every team). */
export function workTypesForTeam(workTypes: WorkTypeOption[], teamId: string | null): WorkTypeOption[] {
  return workTypes.filter((w) => !w.teamIds.length || (!!teamId && w.teamIds.includes(teamId)));
}

export function PeopleForm({
  user,
  defaultRole,
  teams,
  leaders,
  workTypes,
  workspaceDomains,
  busy,
  onSubmit,
}: {
  user: PersonRow | null;
  defaultRole: Role;
  teams: TeamOption[];
  leaders: LeaderOption[];
  workTypes: WorkTypeOption[];
  workspaceDomains: string[];
  busy: boolean;
  onSubmit: (values: PeopleFormValues) => void;
}) {
  const [v, setV] = useState<PeopleFormValues>(() => initial(user, defaultRole));
  const [hours, setHours] = useState(minutesToHours(user?.dailyCapacityMinutes));
  const teamOf = (s: PeopleFormValues) => s.teamId ?? (s.role === "EXECUTIVE" ? (leaders.find((l) => l.id === s.teamLeaderId)?.teamId ?? null) : null);
  // Changing the team (or the executive's leader) drops specialities that no longer belong to the team.
  const patch = (p: Partial<PeopleFormValues>) =>
    setV((s) => {
      const next = { ...s, ...p };
      const allowed = workTypesForTeam(workTypes, teamOf(next));
      return { ...next, specialityIds: (next.specialityIds ?? []).filter((id) => allowed.some((w) => w.id === id)) };
    });
  const isExec = v.role === "EXECUTIVE";
  const hasSpeciality = isExec || v.role === "TEAM_LEADER";
  const specialityOptions = workTypesForTeam(workTypes, teamOf(v));
  const emailHint = domainHint(workspaceDomains);
  const staffDomain = workspaceDomains[0]; // first listed = staff domain (ADR 0018)
  const isLegacyCa = v.role === "CA";
  const roleHint = isLegacyCa ? "CA access is parked — choose another role to keep this person" : ROLE_OPTIONS.find((r) => r.value === v.role)?.hint;

  return (
    <form
      className="flex flex-col gap-3 px-4 pb-2 pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ ...v, dailyCapacityMinutes: hoursToMinutes(hours) });
      }}
    >
      <Field label="Workspace email" hint={emailHint}>
        <input className={inputCls} type="email" required autoComplete="off" value={v.email} onChange={(e) => patch({ email: e.target.value })} placeholder={staffDomain ? `name@${staffDomain}` : "name@company.com"} />
      </Field>
      <Field label="Name">
        <input className={inputCls} required value={v.name} onChange={(e) => patch({ name: e.target.value })} />
      </Field>
      <Field label="Mobile / WhatsApp" hint="Used by the Call and WhatsApp buttons on task cards">
        <input className={inputCls} type="tel" inputMode="tel" autoComplete="off" value={v.phone ?? ""} onChange={(e) => patch({ phone: e.target.value })} placeholder="+91 98300 11122" />
      </Field>
      <Field label="Role" hint={roleHint}>
        <select className={inputCls} value={v.role} onChange={(e) => patch({ role: e.target.value as Role })}>
          {isLegacyCa ? (
            <option value="CA" disabled>
              CA (parked)
            </option>
          ) : null}
          {ROLE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Team (designation)" hint={isExec ? "Defaults to the team leader's team" : v.role === "TEAM_LEADER" ? "One team leader per team" : undefined}>
        <select className={inputCls} value={v.teamId ?? ""} onChange={(e) => patch({ teamId: e.target.value || null })}>
          <option value="">— none —</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>
      {isExec ? (
        <Field label="Reporting team leader">
          <select className={inputCls} required value={v.teamLeaderId ?? ""} onChange={(e) => patch({ teamLeaderId: e.target.value || null })}>
            <option value="">— choose —</option>
            {leaders
              .filter((l) => l.id !== user?.id)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
        </Field>
      ) : null}
      {hasSpeciality ? (
        <Field label="Speciality" hint="Work types they're best at · shown as ✓ when you add a task">
          <PillPicker
            options={specialityOptions}
            value={v.specialityIds ?? []}
            onChange={(specialityIds) => patch({ specialityIds })}
            empty={teamOf(v) ? "This team has no work types yet · Menu → Add Work" : "Pick a team first"}
          />
        </Field>
      ) : null}
      <Field label="Daily capacity override (hours)" hint="Leave blank to use the company default">
        <input className={inputCls} type="number" min={0} max={24} step={0.5} inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="e.g. 8" />
      </Field>
      <Field label="Working days">
        <WeekdayPicker value={v.workingDays ?? []} onChange={(workingDays) => patch({ workingDays })} />
      </Field>
      <FormFooter busy={busy} submitLabel={user ? "Save" : "Add & invite"} />
    </form>
  );
}
