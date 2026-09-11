"use client";
import { useState } from "react";
import type { Role } from "@prisma/client";
import { Field, inputCls } from "@/components/ui/Field";
import { FormFooter, WeekdayPicker, hoursToMinutes, minutesToHours } from "@/components/admin/AdminUi";
import type { LeaderOption, PersonRow, TeamOption } from "@/server/admin/queries";
import type { UserInput } from "@/server/admin/schemas";

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
    teamId: user?.teamId ?? null,
    teamLeaderId: user?.teamLeaderId ?? null,
    dailyCapacityMinutes: user?.dailyCapacityMinutes ?? null,
    workingDays: user?.workingDays ?? [1, 2, 3, 4, 5, 6],
  };
}

export function PeopleForm({
  user,
  defaultRole,
  teams,
  leaders,
  workspaceDomain,
  busy,
  onSubmit,
  onCancel,
}: {
  user: PersonRow | null;
  defaultRole: Role;
  teams: TeamOption[];
  leaders: LeaderOption[];
  workspaceDomain: string;
  busy: boolean;
  onSubmit: (values: PeopleFormValues) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState<PeopleFormValues>(() => initial(user, defaultRole));
  const [hours, setHours] = useState(minutesToHours(user?.dailyCapacityMinutes));
  const patch = (p: Partial<PeopleFormValues>) => setV((s) => ({ ...s, ...p }));
  const isExec = v.role === "EXECUTIVE";
  const emailHint = workspaceDomain ? `Must end with @${workspaceDomain}` : undefined;
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
        <input className={inputCls} type="email" required autoComplete="off" value={v.email} onChange={(e) => patch({ email: e.target.value })} placeholder={workspaceDomain ? `name@${workspaceDomain}` : "name@company.com"} />
      </Field>
      <Field label="Name">
        <input className={inputCls} required value={v.name} onChange={(e) => patch({ name: e.target.value })} />
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
      <Field label="Team (designation)" hint={isExec ? "Defaults to the team leader's team" : undefined}>
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
      <Field label="Daily capacity override (hours)" hint="Leave blank to use the company default">
        <input className={inputCls} type="number" min={0} max={24} step={0.5} inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="e.g. 8" />
      </Field>
      <Field label="Working days">
        <WeekdayPicker value={v.workingDays ?? []} onChange={(workingDays) => patch({ workingDays })} />
      </Field>
      <FormFooter busy={busy} onCancel={onCancel} submitLabel={user ? "Save" : "Add & invite"} />
    </form>
  );
}
