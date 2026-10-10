"use client";
import { useState } from "react";
import type { Role } from "@prisma/client";
import { Sheet } from "@/components/ui/Sheet";
import { Avatar } from "@/components/ui/Avatar";
import { btnDanger, btnSecondary } from "@/components/ui/Field";
import { BarChip, BottomZone, ZonePill, ZoneRow } from "@/components/ui/BottomZone";
import { EmptyState, ListRow, Screen, ScreenHeader, SectionLabel, StatusPill, useAdminAction } from "@/components/admin/AdminUi";
import { PeopleForm, type PeopleFormValues } from "@/components/admin/PeopleForm";
import { PeekZone } from "@/components/shell/PeekBar";
import { useAddForm } from "@/components/shell/useAddForm";
import { LIST_FLOWS } from "@/components/shell/list-flow";
import { createUser, deactivateUser, reactivateUser, updateUser } from "@/server/admin/actions";
import type { LeaderOption, PersonRow, TeamOption, WorkTypeOption } from "@/server/admin/queries";

/** CA access is parked (ADR 0004): no chip / entry point, but legacy CA rows stay visible so Admin can re-role them. */
const GROUPS: { role: Role; label: string }[] = [
  { role: "ADMIN", label: "Admins" },
  { role: "TEAM_LEADER", label: "Team Leaders" },
  { role: "EXECUTIVE", label: "Executives" },
  { role: "HR", label: "HR" },
  { role: "CA", label: "CA (parked — re-assign a role)" },
];

const TITLE: Partial<Record<Role, string>> = { EXECUTIVE: "Add Executive", TEAM_LEADER: "Add Team Leader", HR: "Add HR" };
/** The "+" list flow's minimised bar (ADR 0016 addendum). */
const PEEK: Partial<Record<Role, string>> = { EXECUTIVE: LIST_FLOWS.EXECUTIVE.peek, TEAM_LEADER: LIST_FLOWS.TEAM_LEADER.peek };

/**
 * /admin/people — SPEC §4 and §11.7. `?add=1` opens the invite form for `initialRole`; from the "+" speed dial
 * (`&from=add`, or `?add=min` from its eye) it is the list flow: the form minimises to a bar above the bottom nav
 * (useAddForm). Editing a person is its own sheet and always just closes back to the list.
 */
export function PeopleManager({
  users,
  teams,
  leaders,
  workTypes,
  initialRole,
  workspaceDomains,
  meId,
  editId = null,
  openAdd = false,
}: {
  users: PersonRow[];
  teams: TeamOption[];
  leaders: LeaderOption[];
  workTypes: WorkTypeOption[];
  initialRole: Role;
  workspaceDomains: string[];
  meId: string;
  /** `?edit=<id>` (the card's "Add number", ADR 0017): open that person's form straight away. */
  editId?: string | null;
  /** `?add=1`: open the invite form for `initialRole` on load. */
  openAdd?: boolean;
}) {
  const { busy, run } = useAdminAction();
  const add = useAddForm(openAdd);
  const [formKey, setFormKey] = useState(0); // a blank invite form after each save
  const [editing, setEditing] = useState<PersonRow | null>(() => users.find((u) => u.id === editId) ?? null);
  const [filter, setFilter] = useState<Role | null>(null);
  const closeEdit = () => setEditing(null);
  const title = TITLE[initialRole] ?? "Add person";

  const invite = async (values: PeopleFormValues) => {
    if (!(await run(createUser(values), "Added and invited"))) return;
    setFormKey((k) => k + 1);
    add.saved();
  };
  const save = async (values: PeopleFormValues) => {
    if (editing && (await run(updateUser({ ...values, id: editing.id }), "Saved"))) closeEdit();
  };
  const toggleActive = async (u: PersonRow) => {
    if (await run(u.active ? deactivateUser(u.id) : reactivateUser(u.id), u.active ? "Deactivated" : "Reactivated")) closeEdit();
  };

  const ordered = [...GROUPS].sort((a, b) => (a.role === initialRole ? -1 : b.role === initialRole ? 1 : 0));
  const present = ordered.filter((g) => users.some((u) => u.role === g.role));
  const formProps = { defaultRole: initialRole, teams, leaders, workTypes, workspaceDomains, busy };

  const rolePills = (
    <ZoneRow label="Role">
      <ZonePill active={filter === null} onClick={() => setFilter(null)}>
        All
      </ZonePill>
      {present.map((g) => (
        <ZonePill key={g.role} active={filter === g.role} onClick={() => setFilter(filter === g.role ? null : g.role)}>
          {g.role === "CA" ? "CA (parked)" : g.label}
        </ZonePill>
      ))}
    </ZoneRow>
  );
  const zone = add.inFlow ? (
    <PeekZone label={PEEK[initialRole] ?? "Add person"} onExpand={add.show} rows={rolePills} />
  ) : (
    <BottomZone
      menu
      rows={rolePills}
      right={
        <BarChip label={title} onClick={add.show}>
          + Add
        </BarChip>
      }
    />
  );

  return (
    <Screen header={<ScreenHeader title={TITLE[initialRole] ?? "People"} subtitle={`${users.filter((u) => u.active).length} active · tap a person to edit`} />} zone={zone} className="pb-3">
      {users.length === 0 ? <EmptyState>No people yet. Tap ＋ Add to add the first one.</EmptyState> : null}
      {ordered.map((g) => {
        const rows = users.filter((u) => u.role === g.role);
        if (rows.length === 0 || (filter && filter !== g.role)) return null;
        return (
          <section key={g.role}>
            <SectionLabel>
              {g.label} · {rows.length}
            </SectionLabel>
            {rows.map((u) => (
              <ListRow
                key={u.id}
                title={u.name}
                subtitle={
                  <>
                    {[u.email, u.phone ?? "no number", u.team?.name, u.role === "EXECUTIVE" && u.teamLeader ? `→ ${u.teamLeader.name}` : null].filter(Boolean).join(" · ")}
                    {u.role === "EXECUTIVE" || u.role === "TEAM_LEADER" ? <SpecialityChips names={u.specialities.map((w) => w.name)} /> : null}
                  </>
                }
                leading={<Avatar name={u.name} src={u.avatar} size={32} />}
                trailing={
                  <span className="flex flex-col items-end gap-1">
                    <StatusPill active={u.active} />
                    {!u.activatedAt ? <span className="text-[10px] text-amber-600">Invited</span> : null}
                  </span>
                }
                inactive={!u.active}
                onClick={() => setEditing(u)}
              />
            ))}
          </section>
        );
      })}

      <Sheet open={add.open || add.minimised} minimised={add.minimised} onClose={add.dismiss} onCornerClose={add.cancel} title={title}>
        <PeopleForm key={`new-${formKey}`} user={null} {...formProps} onSubmit={invite} />
      </Sheet>
      <Sheet open={!!editing} onClose={closeEdit} title="Edit person">
        {editing ? (
          <>
            <PeopleForm key={editing.id} user={editing} {...formProps} onSubmit={save} />
            {editing.id !== meId ? (
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
    </Screen>
  );
}

/** "✓ Reels" chips under an executive / team leader (ADR 0008). */
function SpecialityChips({ names }: { names: string[] }) {
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {names.length ? (
        names.map((n) => (
          <span key={n} className="glass-chip rounded-full px-2 py-0.5 text-[10px] font-medium text-gray-700">
            ✓ {n}
          </span>
        ))
      ) : (
        <span className="glass-chip rounded-full px-2 py-0.5 text-[10px] text-gray-400">no speciality set</span>
      )}
    </span>
  );
}
