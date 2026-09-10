"use client";
import { useState } from "react";
import type { Role } from "@prisma/client";
import { Sheet } from "@/components/ui/Sheet";
import { Avatar } from "@/components/ui/Avatar";
import { btnDanger, btnSecondary } from "@/components/ui/Field";
import { EmptyState, Fab, ListRow, ScreenHeader, SectionLabel, StatusPill, useAdminAction } from "@/components/admin/AdminUi";
import { PeopleForm, type PeopleFormValues } from "@/components/admin/PeopleForm";
import { createUser, deactivateUser, reactivateUser, updateUser } from "@/server/admin/actions";
import type { LeaderOption, PersonRow, TeamOption } from "@/server/admin/queries";

const GROUPS: { role: Role; label: string }[] = [
  { role: "ADMIN", label: "Admins" },
  { role: "TEAM_LEADER", label: "Team Leaders" },
  { role: "EXECUTIVE", label: "Executives" },
  { role: "HR", label: "HR" },
  { role: "CA", label: "CA (read-only finance)" },
];

const TITLE: Partial<Record<Role, string>> = { EXECUTIVE: "Add Executive", TEAM_LEADER: "Add Team Leader", HR: "Add HR", CA: "Add CA" };

/** /admin/people — SPEC §4 and §11.7. */
export function PeopleManager({
  users,
  teams,
  leaders,
  initialRole,
  workspaceDomain,
  meId,
}: {
  users: PersonRow[];
  teams: TeamOption[];
  leaders: LeaderOption[];
  initialRole: Role;
  workspaceDomain: string;
  meId: string;
}) {
  const { busy, run } = useAdminAction();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PersonRow | null>(null);
  const close = () => {
    setOpen(false);
    setEditing(null);
  };

  const submit = async (values: PeopleFormValues) => {
    const res = editing ? await run(updateUser({ ...values, id: editing.id }), "Saved") : await run(createUser(values), "Added and invited");
    if (res) close();
  };
  const toggleActive = async (u: PersonRow) => {
    const res = await run(u.active ? deactivateUser(u.id) : reactivateUser(u.id), u.active ? "Deactivated" : "Reactivated");
    if (res) close();
  };

  const ordered = [...GROUPS].sort((a, b) => (a.role === initialRole ? -1 : b.role === initialRole ? 1 : 0));

  return (
    <div className="flex flex-1 flex-col pb-24">
      <ScreenHeader title={TITLE[initialRole] ?? "People"} subtitle={`${users.filter((u) => u.active).length} active · tap a person to edit`} />
      {users.length === 0 ? <EmptyState>No people yet. Tap ＋ to add the first one.</EmptyState> : null}
      {ordered.map((g) => {
        const rows = users.filter((u) => u.role === g.role);
        if (rows.length === 0) return null;
        return (
          <section key={g.role}>
            <SectionLabel>
              {g.label} · {rows.length}
            </SectionLabel>
            {rows.map((u) => (
              <ListRow
                key={u.id}
                title={u.name}
                subtitle={[u.email, u.team?.name, u.role === "EXECUTIVE" && u.teamLeader ? `→ ${u.teamLeader.name}` : null].filter(Boolean).join(" · ")}
                leading={<Avatar name={u.name} src={u.avatar} size={32} />}
                trailing={
                  <span className="flex flex-col items-end gap-1">
                    <StatusPill active={u.active} />
                    {!u.activatedAt ? <span className="text-[10px] text-amber-600">Invited</span> : null}
                  </span>
                }
                inactive={!u.active}
                onClick={() => {
                  setEditing(u);
                  setOpen(true);
                }}
              />
            ))}
          </section>
        );
      })}

      <Fab onClick={() => setOpen(true)} label={TITLE[initialRole] ?? "Add person"} />

      <Sheet open={open} onClose={close} title={editing ? "Edit person" : (TITLE[initialRole] ?? "Add person")}>
        {open ? (
          <>
            <PeopleForm
              key={editing?.id ?? "new"}
              user={editing}
              defaultRole={initialRole}
              teams={teams}
              leaders={leaders}
              workspaceDomain={workspaceDomain}
              busy={busy}
              onSubmit={submit}
              onCancel={close}
            />
            {editing && editing.id !== meId ? (
              <div className="px-4 pb-6 pt-2">
                <button type="button" className={editing.active ? btnDanger : btnSecondary} disabled={busy} onClick={() => toggleActive(editing)}>
                  {editing.active ? "Deactivate user" : "Reactivate user"}
                </button>
                <p className="mt-1 text-[11px] text-gray-400">
                  {editing.active ? "Deactivated users are signed out and cannot log in until reactivated." : "Reactivating lets this person sign in again."}
                </p>
              </div>
            ) : null}
          </>
        ) : null}
      </Sheet>
    </div>
  );
}

