"use client";
import { useEffect, useState } from "react";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { DashboardData, TaskRow } from "@/server/tasks/types";
import { updateTask } from "@/server/tasks/manage";
import { Sheet } from "@/components/ui/Sheet";
import { SheetButtons } from "@/components/ui/CloseX";
import {
  Field,
  btnPrimary,
  btnSecondary,
  inputCls,
} from "@/components/ui/Field";
import { Pill } from "@/components/ui/Pill";
import { useTaskAction } from "@/components/dashboard/useTaskAction";
import { useToast } from "@/components/ui/Toast";
import { GuestEmailInput } from "@/components/tasks/MeetingGuestsSheet";
import { MeetingOptionsSheet } from "@/components/tasks/MeetingOptionsSheet";
import {
  defaultMeetingOptions,
  describeReminder,
  type MeetingOptions,
} from "@/server/tasks/meeting";

type Draft = {
  title: string;
  description: string;
  clientId: string;
  assigneeIds: string[];
  teamIds: string[];
  tagIds: string[];
  allocatedMinutes: number;
  scheduledStart: string; // datetime-local in company tz
  scheduledEnd: string;
  priority: TaskRow["priority"];
  /** Meetings (ADR 0012): outside guests and the Google Calendar options. */
  guestEmails: string[];
  meetingOptions: MeetingOptions;
};

const toLocal = (iso: string | null, tz: string) =>
  iso ? formatInTimeZone(new Date(iso), tz, "yyyy-MM-dd'T'HH:mm") : "";
const toIso = (local: string, tz: string) =>
  local ? fromZonedTime(local, tz).toISOString() : null;

/** Meetings show and take their times in the meeting's own time zone. */
const zoneOf = (t: TaskRow, tz: string) =>
  t.type === "MEETING" ? t.meetingOptions?.timeZone || tz : tz;

function draftOf(t: TaskRow, companyTz: string): Draft {
  const tz = zoneOf(t, companyTz);
  return {
    title: t.title,
    description: t.description,
    clientId: t.client.id,
    assigneeIds: t.assignees.map((a) => a.id),
    teamIds: t.teams.map((x) => x.id),
    tagIds: t.tags.map((x) => x.id),
    allocatedMinutes: t.allocatedMinutes,
    scheduledStart: toLocal(t.scheduledStart, tz),
    scheduledEnd: toLocal(t.scheduledEnd, tz),
    priority: t.priority,
    guestEmails: t.guestEmails ?? [],
    meetingOptions: t.meetingOptions ?? defaultMeetingOptions(tz),
  };
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));
const toggle = (list: string[], id: string) =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

/** Admin edit (SPEC §5.3) → updateTask. Editing clears the red review dot server-side. */
export function EditTaskSheet({
  task,
  data,
  open,
  onClose,
}: {
  task: TaskRow | null;
  data: DashboardData;
  open: boolean;
  onClose: () => void;
}) {
  const { run, busy } = useTaskAction();
  const toast = useToast();
  const [d, setD] = useState<Draft | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  useEffect(() => {
    if (open && task) setD(draftOf(task, data.tz));
  }, [open, task, data.tz]);
  if (!task || !d) return null;
  const t = task;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) =>
    setD({ ...d, [k]: v });
  const meeting = t.type === "MEETING";
  const tz = zoneOf(t, data.tz);
  const zone = meeting ? d.meetingOptions.timeZone || data.tz : data.tz;

  // Work: Admin assigns Team Leaders (or self); executives are changed via their Team Leader. Meetings invite anyone.
  const hasExecutive =
    !meeting &&
    t.assignees.some(
      (a) => data.people.find((p) => p.id === a.id)?.role === "EXECUTIVE",
    );
  const assignable = meeting
    ? data.people
    : data.people.filter(
        (p) => p.role === "TEAM_LEADER" || p.id === data.me.id,
      );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const original = draftOf(t, data.tz);
    const optionsChanged =
      JSON.stringify(d.meetingOptions) !==
      JSON.stringify(original.meetingOptions);
    const res = await run(
      updateTask({
        id: t.id,
        title: d.title,
        description: d.description,
        clientId: d.clientId,
        allocatedMinutes: d.allocatedMinutes,
        scheduledStart: toIso(d.scheduledStart, zone),
        scheduledEnd: toIso(d.scheduledEnd, zone),
        priority: d.priority,
        ...(sameSet(d.assigneeIds, original.assigneeIds)
          ? {}
          : { assigneeIds: d.assigneeIds }),
        ...(sameSet(d.teamIds, original.teamIds) ? {} : { teamIds: d.teamIds }),
        ...(sameSet(d.tagIds, original.tagIds) ? {} : { tagIds: d.tagIds }),
        // Meetings: Calendar gets the new guests / options and emails the update (sendUpdates "all").
        ...(meeting && !sameSet(d.guestEmails, original.guestEmails)
          ? { guestEmails: d.guestEmails }
          : {}),
        ...(meeting && (optionsChanged || zone !== tz)
          ? { meetingOptions: d.meetingOptions }
          : {}),
      }),
      meeting
        ? "Meeting updated · Google Calendar emails the guests"
        : "Task updated",
    );
    if (res !== null) onClose();
  };

  return (
    <>
      <Sheet
        open={open && !optionsOpen}
        onClose={onClose}
        title={meeting ? "Edit meeting" : "Edit task"}
        full
      >
        <form onSubmit={submit} className="space-y-3 px-4 pb-10 pt-3">
          <Field label="Title">
            <input
              value={d.title}
              onChange={(e) => set("title", e.target.value)}
              className={inputCls}
              required
              maxLength={200}
            />
          </Field>
          <Field label="Description">
            <textarea
              rows={4}
              value={d.description}
              onChange={(e) => set("description", e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Client">
            <select
              value={d.clientId}
              onChange={(e) => set("clientId", e.target.value)}
              className={inputCls}
              required
            >
              {[
                ...(data.clients.some((c) => c.id === t.client.id)
                  ? []
                  : [t.client]),
                ...data.clients,
              ].map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Assignees"
            hint={
              hasExecutive
                ? "Executives are assigned via their Team Leader — reassign from the Team Leader's dashboard."
                : undefined
            }
          >
            <div className="flex flex-wrap gap-1.5">
              {hasExecutive
                ? t.assignees.map((a) => (
                    <Pill key={a.id} tone="outline" active>
                      {a.name}
                    </Pill>
                  ))
                : assignable.map((p) => (
                    <Pill
                      key={p.id}
                      tone="outline"
                      active={d.assigneeIds.includes(p.id)}
                      onClick={() =>
                        set("assigneeIds", toggle(d.assigneeIds, p.id))
                      }
                    >
                      {p.name}
                    </Pill>
                  ))}
            </div>
          </Field>
          {meeting ? (
            <>
              <Field
                label="Outside guests"
                hint="Client and other external emails. Internal people are the assignees above."
              >
                <GuestEmailInput
                  emails={d.guestEmails}
                  onChange={(v) => set("guestEmails", v)}
                  onError={(m) => toast(m, "err")}
                />
              </Field>
              <Field label="Meeting options">
                <button
                  type="button"
                  className={btnSecondary + " w-full justify-between"}
                  onClick={() => setOptionsOpen(true)}
                >
                  <span className="truncate text-[13px] font-medium">
                    {[
                      d.meetingOptions.withMeet ? "Meet" : "No Meet",
                      d.meetingOptions.allDay ? "all day" : null,
                      d.meetingOptions.location || null,
                      d.meetingOptions.reminders[0]
                        ? describeReminder(d.meetingOptions.reminders[0])
                        : "no notifications",
                      zone,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span aria-hidden>⚙</span>
                </button>
              </Field>
            </>
          ) : null}
          <Field label="Teams">
            <div className="flex flex-wrap gap-1.5">
              {data.teams.map((x) => (
                <Pill
                  key={x.id}
                  tone="outline"
                  active={d.teamIds.includes(x.id)}
                  onClick={() => set("teamIds", toggle(d.teamIds, x.id))}
                >
                  {x.name}
                </Pill>
              ))}
            </div>
          </Field>
          {meeting ? null : (
            <Field label="Tags">
              <div className="flex flex-wrap gap-1.5">
                {data.workTypes.map((x) => (
                  <Pill
                    key={x.id}
                    tone="outline"
                    active={d.tagIds.includes(x.id)}
                    onClick={() => set("tagIds", toggle(d.tagIds, x.id))}
                  >
                    {x.name}
                  </Pill>
                ))}
              </div>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Allocated (minutes)">
              <input
                type="number"
                min={5}
                step={5}
                value={d.allocatedMinutes}
                onChange={(e) =>
                  set(
                    "allocatedMinutes",
                    Math.max(5, Number(e.target.value) || 0),
                  )
                }
                className={inputCls}
              />
            </Field>
            <Field label="Priority">
              <select
                value={d.priority}
                onChange={(e) =>
                  set("priority", e.target.value as Draft["priority"])
                }
                className={inputCls}
              >
                {(["LOW", "NORMAL", "HIGH", "URGENT"] as const).map((p) => (
                  <option key={p} value={p}>
                    {p.toLowerCase()}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Scheduled start">
              <input
                type="datetime-local"
                value={d.scheduledStart}
                onChange={(e) => set("scheduledStart", e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Scheduled end">
              <input
                type="datetime-local"
                value={d.scheduledEnd}
                onChange={(e) => set("scheduledEnd", e.target.value)}
                className={inputCls}
              />
            </Field>
          </div>
          <SheetButtons className="pt-2">
            <button
              type="submit"
              className={btnPrimary}
              disabled={
                busy ||
                !d.title.trim() ||
                !d.clientId ||
                d.assigneeIds.length === 0
              }
            >
              Save
            </button>
          </SheetButtons>
        </form>
      </Sheet>
      {meeting ? (
        <MeetingOptionsSheet
          open={open && optionsOpen}
          onClose={() => setOptionsOpen(false)}
          value={d.meetingOptions}
          onChange={(v) => set("meetingOptions", v)}
          companyTz={data.tz}
        />
      ) : null}
    </>
  );
}
